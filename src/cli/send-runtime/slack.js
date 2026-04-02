import { sendMessageSlack as sendMessageSlackImpl } from "../../plugin-sdk/slack.js";
export const runtimeSend = {
    sendMessage: sendMessageSlackImpl,
};
