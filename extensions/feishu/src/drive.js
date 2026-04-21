import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuDriveSchema } from "./drive-schema.js";
import { createFeishuToolClient, resolveAnyEnabledFeishuToolsConfig } from "./tool-account.js";
import {
  jsonToolResult,
  toolExecutionErrorResult,
  unknownToolActionResult,
} from "./tool-result.js";
const FEISHU_COMMENT_FILE_TYPES = new Set(["doc", "docx", "file", "sheet", "slides"]);
const FEISHU_DRIVE_REQUEST_TIMEOUT_MS = 30000;
class FeishuReplyCommentError extends Error {
  httpStatus;
  feishuCode;
  feishuMsg;
  feishuLogId;
  constructor(params) {
    super(params.message);
    this.name = "FeishuReplyCommentError";
    this.httpStatus = params.httpStatus;
    this.feishuCode = params.feishuCode;
    this.feishuMsg = params.feishuMsg;
    this.feishuLogId = params.feishuLogId;
  }
}
function getDriveInternalClient(client) {
  return client;
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function readString(value) {
  return typeof value === "string" ? value : undefined;
}
function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function encodeQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) {
      query.set(key, trimmed);
    }
  }
  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}
function normalizeCommentFileType(value) {
  return typeof value === "string" && FEISHU_COMMENT_FILE_TYPES.has(value) ? value : undefined;
}
function parseFeishuCommentTarget(raw) {
  const trimmed = raw?.trim();
  if (!trimmed?.startsWith("comment:")) {
    return null;
  }
  const parts = trimmed.split(":");
  if (parts.length !== 4) {
    return null;
  }
  const fileType = normalizeCommentFileType(parts[1]);
  const fileToken = parts[2]?.trim();
  const commentId = parts[3]?.trim();
  if (!fileType || !fileToken || !commentId) {
    return null;
  }
  return {
    fileType,
    fileToken,
    commentId,
  };
}
function extractCommentElementText(element) {
  if (!isRecord(element)) {
    return undefined;
  }
  const type = normalizeString(element.type);
  if (type === "text_run" && isRecord(element.text_run)) {
    return normalizeString(element.text_run.content) || normalizeString(element.text_run.text);
  }
  if (type === "mention") {
    const mention = isRecord(element.mention) ? element.mention : undefined;
    const mentionName =
      normalizeString(mention?.name) ||
      normalizeString(mention?.display_name) ||
      normalizeString(element.name);
    return mentionName ? `@${mentionName}` : "@mention";
  }
  if (type === "docs_link") {
    const docsLink = isRecord(element.docs_link) ? element.docs_link : undefined;
    return (
      normalizeString(docsLink?.text) ||
      normalizeString(docsLink?.url) ||
      normalizeString(element.text) ||
      normalizeString(element.url) ||
      undefined
    );
  }
  return (
    normalizeString(element.text) ||
    normalizeString(element.content) ||
    normalizeString(element.name) ||
    undefined
  );
}
function extractReplyText(reply) {
  if (!reply || !isRecord(reply.content)) {
    return undefined;
  }
  const elements = Array.isArray(reply.content.elements) ? reply.content.elements : [];
  const text = elements
    .map(extractCommentElementText)
    .filter((part) => Boolean(part && part.trim()))
    .join("")
    .trim();
  return text || undefined;
}
function buildReplyElements(content) {
  return [{ type: "text", text: content }];
}
async function requestDriveApi(params) {
  const internalClient = getDriveInternalClient(params.client);
  return await internalClient.request({
    method: params.method,
    url: params.url,
    params: params.query ?? {},
    data: params.data ?? {},
    timeout: FEISHU_DRIVE_REQUEST_TIMEOUT_MS,
  });
}
function assertDriveApiSuccess(response) {
  if (response.code !== 0) {
    throw new Error(response.msg ?? "Feishu Drive API request failed");
  }
  return response;
}
function normalizeCommentReply(reply) {
  return {
    reply_id: reply.reply_id,
    user_id: reply.user_id,
    create_time: reply.create_time,
    update_time: reply.update_time,
    text: extractReplyText(reply),
  };
}
function normalizeCommentCard(comment) {
  const replies = comment.reply_list?.replies ?? [];
  const rootReply = replies[0];
  return {
    comment_id: comment.comment_id,
    user_id: comment.user_id,
    create_time: comment.create_time,
    update_time: comment.update_time,
    is_solved: comment.is_solved,
    is_whole: comment.is_whole,
    quote: comment.quote,
    text: extractReplyText(rootReply),
    has_more_replies: comment.has_more,
    replies_page_token: comment.page_token,
    replies: replies.slice(1).map(normalizeCommentReply),
  };
}
function normalizeCommentPageSize(pageSize) {
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize)) {
    return undefined;
  }
  return String(Math.min(Math.max(Math.floor(pageSize), 1), 100));
}
function resolveAmbientCommentTarget(context) {
  const deliveryContext = context?.deliveryContext;
  if (deliveryContext?.channel && deliveryContext.channel !== "feishu") {
    return null;
  }
  return parseFeishuCommentTarget(deliveryContext?.to);
}
function applyAmbientCommentDefaults(params, context) {
  const ambient = resolveAmbientCommentTarget(context);
  if (!ambient) {
    return params;
  }
  return {
    ...params,
    file_token: params.file_token?.trim() || ambient.fileToken,
    file_type: params.file_type ?? ambient.fileType,
    comment_id: params.comment_id?.trim() || ambient.commentId,
  };
}
function applyAddCommentAmbientDefaults(params, context) {
  const ambient = resolveAmbientCommentTarget(context);
  if (!ambient || (ambient.fileType !== "doc" && ambient.fileType !== "docx")) {
    return params;
  }
  return {
    ...params,
    file_token: params.file_token?.trim() || ambient.fileToken,
    file_type: params.file_type ?? ambient.fileType,
  };
}
function applyAddCommentDefaults(params) {
  const fileType = params.file_type ?? "docx";
  if (!params.file_type) {
    console.info(
      `[feishu_drive] add_comment missing file_type; defaulting to docx ` +
        `file_token=${params.file_token ?? "unknown"}`,
    );
  }
  return {
    ...params,
    file_type: fileType,
  };
}
function applyCommentFileTypeDefault(params, action) {
  const fileType = params.file_type ?? "docx";
  if (!params.file_type) {
    console.info(
      `[feishu_drive] ${action} missing file_type; defaulting to docx ` +
        `file_token=${params.file_token ?? "unknown"}`,
    );
  }
  return {
    ...params,
    file_type: fileType,
  };
}
function formatDriveApiError(error) {
  if (!isRecord(error)) {
    return typeof error === "string" ? error : JSON.stringify(error);
  }
  const response = isRecord(error.response) ? error.response : undefined;
  const responseData = isRecord(response?.data) ? response.data : undefined;
  return JSON.stringify({
    message:
      typeof error.message === "string"
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error),
    code: readString(error.code),
    method: readString(isRecord(error.config) ? error.config.method : undefined),
    url: readString(isRecord(error.config) ? error.config.url : undefined),
    params: isRecord(error.config) ? error.config.params : undefined,
    http_status: typeof response?.status === "number" ? response.status : undefined,
    feishu_code:
      typeof responseData?.code === "number" ? responseData.code : readString(responseData?.code),
    feishu_msg: readString(responseData?.msg),
    feishu_log_id: readString(responseData?.log_id),
  });
}
function extractDriveApiErrorMeta(error) {
  if (!isRecord(error)) {
    return { message: typeof error === "string" ? error : JSON.stringify(error) };
  }
  const response = isRecord(error.response) ? error.response : undefined;
  const responseData = isRecord(response?.data) ? response.data : undefined;
  return {
    message:
      typeof error.message === "string"
        ? error.message
        : typeof error === "string"
          ? error
          : JSON.stringify(error),
    httpStatus: typeof response?.status === "number" ? response.status : undefined,
    feishuCode:
      typeof responseData?.code === "number" ? responseData.code : readString(responseData?.code),
    feishuMsg: readString(responseData?.msg),
    feishuLogId: readString(responseData?.log_id),
  };
}
function isReplyNotAllowedError(error) {
  return error instanceof FeishuReplyCommentError && error.feishuCode === 1069302;
}
async function getRootFolderToken(client) {
  const internalClient = getDriveInternalClient(client);
  const domain = internalClient.domain ?? "https://open.feishu.cn";
  const res = await internalClient.httpInstance.get(
    `${domain}/open-apis/drive/explorer/v2/root_folder/meta`,
  );
  if (res.code !== 0) {
    throw new Error(res.msg ?? "Failed to get root folder");
  }
  const token = res.data?.token;
  if (!token) {
    throw new Error("Root folder token not found");
  }
  return token;
}
async function listFolder(client, folderToken) {
  const validFolderToken = folderToken && folderToken !== "0" ? folderToken : undefined;
  const res = await client.drive.file.list({
    params: validFolderToken ? { folder_token: validFolderToken } : {},
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  return {
    files:
      res.data?.files?.map((f) => ({
        token: f.token,
        name: f.name,
        type: f.type,
        url: f.url,
        created_time: f.created_time,
        modified_time: f.modified_time,
        owner_id: f.owner_id,
      })) ?? [],
    next_page_token: res.data?.next_page_token,
  };
}
async function getFileInfo(client, fileToken, folderToken) {
  const res = await client.drive.file.list({
    params: folderToken ? { folder_token: folderToken } : {},
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  const file = res.data?.files?.find((f) => f.token === fileToken);
  if (!file) {
    throw new Error(`File not found: ${fileToken}`);
  }
  return {
    token: file.token,
    name: file.name,
    type: file.type,
    url: file.url,
    created_time: file.created_time,
    modified_time: file.modified_time,
    owner_id: file.owner_id,
  };
}
async function createFolder(client, name, folderToken) {
  let effectiveToken = folderToken && folderToken !== "0" ? folderToken : "0";
  if (effectiveToken === "0") {
    try {
      effectiveToken = await getRootFolderToken(client);
    } catch {}
  }
  const res = await client.drive.file.createFolder({
    data: {
      name,
      folder_token: effectiveToken,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  return {
    token: res.data?.token,
    url: res.data?.url,
  };
}
async function moveFile(client, fileToken, type, folderToken) {
  const res = await client.drive.file.move({
    path: { file_token: fileToken },
    data: {
      type,
      folder_token: folderToken,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  return {
    success: true,
    task_id: res.data?.task_id,
  };
}
async function deleteFile(client, fileToken, type) {
  const res = await client.drive.file.delete({
    path: { file_token: fileToken },
    params: {
      type,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }
  return {
    success: true,
    task_id: res.data?.task_id,
  };
}
async function listComments(client, params) {
  const response = assertDriveApiSuccess(
    await requestDriveApi({
      client,
      method: "GET",
      url:
        `/open-apis/drive/v1/files/${encodeURIComponent(params.file_token)}/comments` +
        encodeQuery({
          file_type: params.file_type,
          page_size: normalizeCommentPageSize(params.page_size),
          page_token: params.page_token,
          user_id_type: "open_id",
        }),
    }),
  );
  return {
    has_more: response.data?.has_more ?? false,
    page_token: response.data?.page_token,
    comments: (response.data?.items ?? []).map(normalizeCommentCard),
  };
}
async function listCommentReplies(client, params) {
  const response = assertDriveApiSuccess(
    await requestDriveApi({
      client,
      method: "GET",
      url:
        `/open-apis/drive/v1/files/${encodeURIComponent(params.file_token)}/comments/${encodeURIComponent(params.comment_id)}/replies` +
        encodeQuery({
          file_type: params.file_type,
          page_size: normalizeCommentPageSize(params.page_size),
          page_token: params.page_token,
          user_id_type: "open_id",
        }),
    }),
  );
  return {
    has_more: response.data?.has_more ?? false,
    page_token: response.data?.page_token,
    replies: (response.data?.items ?? []).map(normalizeCommentReply),
  };
}
async function addComment(client, params) {
  if (params.block_id?.trim() && params.file_type !== "docx") {
    throw new Error("block_id is only supported for docx comments");
  }
  const response = assertDriveApiSuccess(
    await requestDriveApi({
      client,
      method: "POST",
      url: `/open-apis/drive/v1/files/${encodeURIComponent(params.file_token)}/new_comments`,
      data: {
        file_type: params.file_type,
        reply_elements: buildReplyElements(params.content),
        ...(params.block_id?.trim() ? { anchor: { block_id: params.block_id.trim() } } : {}),
      },
    }),
  );
  return {
    success: true,
    ...response.data,
  };
}
async function queryCommentById(client, params) {
  const response = assertDriveApiSuccess(
    await requestDriveApi({
      client,
      method: "POST",
      url:
        `/open-apis/drive/v1/files/${encodeURIComponent(params.file_token)}/comments/batch_query` +
        encodeQuery({
          file_type: params.file_type,
          user_id_type: "open_id",
        }),
      data: {
        comment_ids: [params.comment_id],
      },
    }),
  );
  return response.data?.items?.find((comment) => comment.comment_id?.trim() === params.comment_id);
}
export async function replyComment(client, params) {
  const url = `/open-apis/drive/v1/files/${encodeURIComponent(params.file_token)}/comments/${encodeURIComponent(params.comment_id)}/replies`;
  try {
    const response = await requestDriveApi({
      client,
      method: "POST",
      url,
      query: { file_type: params.file_type },
      data: {
        content: {
          elements: [
            {
              type: "text_run",
              text_run: {
                text: params.content,
              },
            },
          ],
        },
      },
    });
    if (response.code === 0) {
      return {
        success: true,
        ...response.data,
      };
    }
    console.warn(
      `[feishu_drive] replyComment failed ` +
        `comment=${params.comment_id} file_type=${params.file_type} ` +
        `code=${response.code ?? "unknown"} ` +
        `msg=${response.msg ?? "unknown"} log_id=${response.log_id ?? "unknown"}`,
    );
    throw new FeishuReplyCommentError({
      message: response.msg ?? "Feishu Drive reply comment failed",
      feishuCode: response.code,
      feishuMsg: response.msg,
      feishuLogId: response.log_id,
    });
  } catch (error) {
    if (error instanceof FeishuReplyCommentError) {
      throw error;
    }
    const meta = extractDriveApiErrorMeta(error);
    console.warn(
      `[feishu_drive] replyComment threw ` +
        `comment=${params.comment_id} file_type=${params.file_type} ` +
        `error=${formatDriveApiError(error)}`,
    );
    throw new FeishuReplyCommentError({
      message: meta.message,
      httpStatus: meta.httpStatus,
      feishuCode: meta.feishuCode,
      feishuMsg: meta.feishuMsg,
      feishuLogId: meta.feishuLogId,
    });
  }
}
export async function deliverCommentThreadText(client, params) {
  let isWholeComment = params.is_whole_comment;
  if (isWholeComment === undefined) {
    try {
      const comment = await queryCommentById(client, params);
      isWholeComment = comment?.is_whole === true;
    } catch (error) {
      console.warn(
        `[feishu_drive] comment metadata preflight failed ` +
          `comment=${params.comment_id} file_type=${params.file_type} ` +
          `error=${formatErrorMessage(error)}`,
      );
      isWholeComment = false;
    }
  }
  if (isWholeComment) {
    if (params.file_type !== "doc" && params.file_type !== "docx") {
      throw new Error(
        `Whole-document comment follow-ups are only supported for doc/docx (got ${params.file_type})`,
      );
    }
    console.info(
      `[feishu_drive] whole-comment compatibility path ` +
        `comment=${params.comment_id} file_type=${params.file_type} mode=add_comment`,
    );
    return {
      delivery_mode: "add_comment",
      ...(await addComment(client, {
        file_token: params.file_token,
        file_type: params.file_type,
        content: params.content,
      })),
    };
  }
  try {
    return {
      delivery_mode: "reply_comment",
      ...(await replyComment(client, params)),
    };
  } catch (error) {
    if (isReplyNotAllowedError(error)) {
      if (params.file_type !== "doc" && params.file_type !== "docx") {
        throw error;
      }
      console.info(
        `[feishu_drive] reply-not-allowed compatibility path ` +
          `comment=${params.comment_id} file_type=${params.file_type} mode=add_comment ` +
          `log_id=${error.feishuLogId ?? "unknown"}`,
      );
      return {
        delivery_mode: "add_comment",
        ...(await addComment(client, {
          file_token: params.file_token,
          file_type: params.file_type,
          content: params.content,
        })),
      };
    }
    throw error;
  }
}
export function registerFeishuDriveTools(api) {
  if (!api.config) {
    api.logger.debug?.("feishu_drive: No config available, skipping drive tools");
    return;
  }
  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_drive: No Feishu accounts configured, skipping drive tools");
    return;
  }
  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.drive) {
    api.logger.debug?.("feishu_drive: drive tool disabled in config");
    return;
  }
  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_drive",
        label: "Feishu Drive",
        description:
          "Feishu cloud storage operations. Actions: list, info, create_folder, move, delete, list_comments, list_comment_replies, add_comment, reply_comment",
        parameters: FeishuDriveSchema,
        async execute(_toolCallId, params) {
          const p = params;
          try {
            const client = createFeishuToolClient({
              api,
              executeParams: p,
              defaultAccountId,
            });
            switch (p.action) {
              case "list":
                return jsonToolResult(await listFolder(client, p.folder_token));
              case "info":
                return jsonToolResult(await getFileInfo(client, p.file_token));
              case "create_folder":
                return jsonToolResult(await createFolder(client, p.name, p.folder_token));
              case "move":
                return jsonToolResult(await moveFile(client, p.file_token, p.type, p.folder_token));
              case "delete":
                return jsonToolResult(await deleteFile(client, p.file_token, p.type));
              case "list_comments": {
                const resolved = applyCommentFileTypeDefault(
                  applyAmbientCommentDefaults(p, ctx),
                  "list_comments",
                );
                return jsonToolResult(await listComments(client, resolved));
              }
              case "list_comment_replies": {
                const resolved = applyCommentFileTypeDefault(
                  applyAmbientCommentDefaults(p, ctx),
                  "list_comment_replies",
                );
                return jsonToolResult(await listCommentReplies(client, resolved));
              }
              case "add_comment": {
                const resolved = applyAddCommentDefaults(applyAddCommentAmbientDefaults(p, ctx));
                return jsonToolResult(await addComment(client, resolved));
              }
              case "reply_comment": {
                const resolved = applyCommentFileTypeDefault(
                  applyAmbientCommentDefaults(p, ctx),
                  "reply_comment",
                );
                return jsonToolResult(await deliverCommentThreadText(client, resolved));
              }
              default:
                return unknownToolActionResult(p.action);
            }
          } catch (err) {
            return toolExecutionErrorResult(err);
          }
        },
      };
    },
    { name: "feishu_drive" },
  );
  api.logger.info?.("feishu_drive: Registered feishu_drive tool");
}
