import os
import re

tasks = [
    {
        "file": "f:/openclaw-desktop-cn/ui/src/ui/views/usage.ts",
        "replacements": [
            ('<div class="card-title" style="margin: 0;">Token Usage</div>', '<div class="card-title" style="margin: 0;">令牌用量</div>'),
            ('Loading\\n              </span>', '加载中\\n              </span>'),
            ('<span style="color: var(--muted);">to</span>', '<span style="color: var(--muted);">至</span>'),
            ('{ label: "Today", days: 1 }', '{ label: "今天", days: 1 }'),
            ('<div class="usage-page-title">Usage</div>', '<div class="usage-page-title">使用情况</div>'),
            ('<div class="usage-page-subtitle">See where tokens go, when sessions spike, and what drives cost.</div>', '<div class="usage-page-subtitle">了解令牌去向、会话峰值出现时间以及费用驱动因素。</div>'),
            ('<div class="card-title" style="margin: 0;">Filters</div>', '<div class="card-title" style="margin: 0;">筛选器</div>'),
            ('<span class="usage-refresh-indicator">Loading</span>', '<span class="usage-refresh-indicator">加载中</span>'),
            ('<span class="usage-query-hint">Select a date range and click Refresh to load usage.</span>', '<span class="usage-query-hint">选择日期范围并点击“刷新”加载使用情况。</span>'),
            ('</strong> tokens', '</strong> 令牌'),
            ('</strong> cost', '</strong> 费用'),
            ('session${displaySessionCount !== 1 ? "s" : ""}', '个会话'),
            ('title=${props.headerPinned ? "Unpin filters" : "Pin filters"}', 'title=${props.headerPinned ? "取消固定筛选器" : "固定筛选器"}'),
            ('${props.headerPinned ? "Pinned" : "Pin"}', '${props.headerPinned ? "已固定" : "固定"}'),
            ('<summary class="usage-export-button">Export ▾</summary>', '<summary class="usage-export-button">导出 ▾</summary>'),
            ('>\\n                  Sessions CSV\\n                </button>', '>\\n                  导出为 CSV (会话)\\n                </button>'),
            ('>\\n                  Daily CSV\\n                </button>', '>\\n                  导出为 CSV (每日)\\n                </button>'),
            ('>\\n                  JSON\\n                </button>', '>\\n                  导出为 JSON\\n                </button>'),
            ('title="Start Date"', 'title="开始日期"'),
            ('title="End Date"', 'title="结束日期"'),
            ('title="Time zone"', 'title="时区"'),
            ('<option value="local">Local</option>', '<option value="local">本地时间</option>'),
            ('>\\n              Tokens\\n            </button>', '>\\n              令牌\\n            </button>'),
            ('>\\n              Cost\\n            </button>', '>\\n              费用\\n            </button>'),
            ('>\\n            Refresh\\n          </button>', '>\\n            刷新\\n          </button>'),
            ('placeholder="Filter sessions (e.g. key:agent:main:cron* model:gpt-4o has:errors minTokens:2000)"', 'placeholder="筛选会话 (例如: key:agent:main:cron* model:gpt-4o has:errors minTokens:2000)"'),
            ('>\\n              Filter (client-side)\\n            </button>', '>\\n              筛选 (本地计算)\\n            </button>'),
            ('>Clear</button>', '>清除</button>'),
            ('${filteredSessions.length} of ${totalSessions} sessions match', '${filteredSessions.length} / ${totalSessions} 个会话匹配'),
            ('${totalSessions} sessions in range', '范围内共有 ${totalSessions} 个会话'),
            ('renderFilterSelect("agent", "Agent",', 'renderFilterSelect("agent", "代理",'),
            ('renderFilterSelect("channel", "Channel",', 'renderFilterSelect("channel", "渠道",'),
            ('renderFilterSelect("provider", "Provider",', 'renderFilterSelect("provider", "供应商",'),
            ('renderFilterSelect("model", "Model",', 'renderFilterSelect("model", "模型",'),
            ('renderFilterSelect("tool", "Tool",', 'renderFilterSelect("tool", "工具",'),
            ('Tip: use filters or click bars to filter days.', '提示: 使用筛选项或点击柱状图过滤天数。'),
            ('title="Remove filter"', 'title="移除筛选"'),
            ('Showing first 1,000 sessions. Narrow date range for complete results.', '由于数据量过大，目前仅显示前 1000 个会话。请缩小时间范围以查看完整结果。'),
            ('>\\n              Select All\\n            </button>', '>\\n              全选\\n            </button>'),
            ('>\\n              Clear\\n            </button>', '>\\n              清除\\n            </button>'),
            ('>All</span>', '>全部</span>')
        ]
    },
    {
        "file": "f:/openclaw-desktop-cn/ui/src/ui/views/usage-render-details.ts",
        "replacements": [
            ('<div class="muted">No usage data for this session.</div>', '<div class="muted">此会话暂无用量数据。</div>'),
            ('<div class="session-summary-title">Messages</div>', '<div class="session-summary-title">消息数</div>'),
            ('user ·', '用户 ·'),
            ('assistant</div>', '助手</div>'),
            ('<div class="session-summary-title">Tool Calls</div>', '<div class="session-summary-title">工具调用</div>'),
            ('tools</div>', '个工具</div>'),
            ('<div class="session-summary-title">Errors</div>', '<div class="session-summary-title">错误</div>'),
            ('tool results</div>', '个工具调用结果</div>'),
            ('<div class="session-summary-title">Duration</div>', '<div class="session-summary-title">运行时长</div>'),
            ('renderInsightList("Top Tools"', 'renderInsightList("热门工具"'),
            ('"No tool calls"', '"暂无工具调用"'),
            ('renderInsightList("Model Mix"', 'renderInsightList("模型占比"'),
            ('"No model data"', '"暂无模型数据"'),
            (' (filtered)', ' (已过滤)'),
            ('</strong> tokens${cursorIndicator}</span>', '</strong> 令牌${cursorIndicator}</span>'),
            ('title="Close session details"', 'title="关闭会话详情"'),
            ('<div class="muted" style="padding: 20px; text-align: center">Loading...</div>', '<div class="muted" style="padding: 20px; text-align: center">加载中...</div>'),
            ('<div class="muted" style="padding: 20px; text-align: center">No timeline data</div>', '<div class="muted" style="padding: 20px; text-align: center">暂无时间线数据</div>'),
            ('<div class="muted" style="padding: 20px; text-align: center">No data in range</div>', '<div class="muted" style="padding: 20px; text-align: center">范围内暂无数据</div>'),
            ('>Usage Over Time</div>', '>用量时间线</div>'),
            ('>Reset</button>', '>重置</button>'),
            ('>\\n              Per Turn\\n            </button>', '>\\n              单轮对话\\n            </button>'),
            ('>\\n              Cumulative\\n            </button>', '>\\n              累计\\n            </button>'),
            ('>\\n                      Total\\n                    </button>', '>\\n                      总计\\n                    </button>'),
            ('>\\n                      By Type\\n                    </button>', '>\\n                      按类型\\n                    </button>'),
            ('▶ Turns ${rangeStartIdx + 1}', '▶ 轮次 ${rangeStartIdx + 1}'),
            ('of ${points.length}', '/ ${points.length}'),
            ('>Tokens by Type</div>', '>按来源类型统计令牌</div>'),
            ('<div class="muted" style="padding: 20px; text-align: center">No context data</div>', '<div class="muted" style="padding: 20px; text-align: center">暂无上下文数据</div>'),
            ('>System Prompt Breakdown</div>', '>System Prompt 组成分析</div>'),
            ('${showAll ? "Collapse" : "Expand all"}', '${showAll ? "收起" : "展开详情"}'),
            ('${contextPct || "Base context per message"}', '${contextPct || "每轮消息中的公共基础上下文长度"}'),
            ('sub: "calls"', 'sub: "次调用"'),
            ('title="Assistant output tokens"', 'title="助手输出令牌"'),
            ('title="User + tool input tokens"', 'title="用户 + 工具输入令牌"'),
            ('title="Tokens written to cache"', 'title="写入缓存的令牌"'),
            ('title="Tokens read from cache"', 'title="从缓存读取的令牌"'),
            ('>Output ${formatTokens', '>模型输出 ${formatTokens'),
            ('>Input ${formatTokens', '>消息输入 ${formatTokens'),
            ('>Cache Write ${formatTokens', '>缓存写入 ${formatTokens'),
            ('>Cache Read ${formatTokens', '>缓存读取 ${formatTokens'),
            ('Total: ${formatTokens(totalTypeTokens)}', '合计: ${formatTokens(totalTypeTokens)}'),
            ('>Skills (', '>技能 / Skills ('),
            ('>Tools (', '>工具 / Tools ('),
            ('>Files (', '>文件 / Files ('),
            ('} more</div>', '} 更多数据</div>'),
            ('>Conversation</div>', '>完整对话记录</div>'),
            ('<div class="muted" style="padding: 20px; text-align: center">No messages</div>', '<div class="muted" style="padding: 20px; text-align: center">暂无对话消息</div>'),
            ('${filteredEntries.length} of ${logs.length}', '${filteredEntries.length} / ${logs.length}'),
            ('(timeline filtered)', '(按时间线筛选)'),
            ('messages)</span></span>', '条消息)</span></span>'),
            ('${expandedAll ? "Collapse All" : "Expand All"}', '${expandedAll ? "全部收起" : "全部展开"}'),
            ('>User</option>', '>用户 (User)</option>'),
            ('>Assistant</option>', '>助手 (Assistant)</option>'),
            ('>Tool</option>', '>工具 (Tool)</option>'),
            ('>Tool result</option>', '>工具返回 (Tool Result)</option>'),
            ('Has tools', '包含工具'),
            ('placeholder="Search conversation"', 'placeholder="检索回放内容"'),
            ('>\\n          Clear\\n        </button>', '>\\n          清除搜索\\n        </button>'),
            ('log.role === "user" ? "You" : log.role === "assistant" ? "Assistant" : "Tool"', 'log.role === "user" ? "你" : log.role === "assistant" ? "助手" : "工具"'),
            ('<div class="muted" style="padding: 12px">No messages match the filters.</div>', '<div class="muted" style="padding: 12px">当前的检索和过滤条件下没有匹配的消息。</div>')
        ]
    }
]

for task in tasks:
    with open(task["file"], "r", encoding="utf-8") as f:
        content = f.read()
    
    for old, new in task["replacements"]:
        content = content.replace(old, new)
        
    with open(task["file"], "w", encoding="utf-8") as f:
        f.write(content)
        
print("Translations applied successfully!")
