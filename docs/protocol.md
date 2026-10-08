# 真心话大冒险实时协议

协议版本为 `1`，源定义在 [shared/protocol.ts](../shared/protocol.ts)。客户端 C# 字段名与这里的 JSON 一致。

## 连接

1. `POST /api/guest`，正文 `{ "nickname": "小明", "sessionToken": "可选" }`。
2. 返回 `{ "ok": true, "playerId": "...", "sessionToken": "...", "nickname": "小明" }`。
3. 使用 Socket.IO v4，仅 WebSocket 传输。连接地址为 `http://主机:8787`，握手参数 `auth.token = sessionToken`。
4. 重连后先发送 `room.sync`。服务端返回完整快照；之后只接受 `revision == 本地 + 1` 的 `room.state`。更旧的事件忽略，跳号则重新同步。

## 客户端事件

| 事件 | 正文 | 说明 |
| --- | --- | --- |
| `room.create` | `{ contentLevel, allowAdult }` | 创建自建房，人数不设产品上限 |
| `room.join` | `{ code }` | 用 6 位房间码加入 |
| `room.leave` | `{}` | 立即离开 |
| `room.ready` | `{ ready }` | 大厅准备 |
| `room.start` | `{}` | 房主开始，至少 2 人且全员准备 |
| `room.kick` | `{ playerId }` | 房主移出玩家 |
| `room.settings` | `{ contentLevel, allowAdult }` | 房主在大厅修改题库 |
| `room.sync` | `{}` | 拉取当前快照 |
| `match.enqueue` | `{ contentLevel, allowAdult }` | 进入 4 人匹配 |
| `match.cancel` | `{}` | 取消匹配 |
| `chat.send` | `{ text }` | 1 到 200 字 |
| `game.choose` | `{ choice, requestId }` | `choice` 为 `truth` 或 `dare` |
| `game.complete` | `{ requestId }` | 标记完成 |
| `game.skip` | `{ requestId }` | 每局一次主动跳过 |

所有事件都使用 Socket.IO ACK：`{ ok, error, snapshot, match }`。相同 `requestId` 的出题、完成和跳过是幂等的。

## 服务端事件

| 事件 | 正文 | 说明 |
| --- | --- | --- |
| `room.state` | `{ revision, reason, room }` | 权威房间状态 |
| `match.queued` | `{ queued, size, needed }` | 匹配队列进度，`needed` 固定为 4 |
| `match.found` | `{ revision, reason, room }` | 匹配成功 |
| `kicked` | `{ roomId }` | 被移出 |
| `game.error` | `{ code, message }` | 操作被拒绝 |
| `room.closed` | `{ roomId }` | 房间已关闭 |

`contentLevel` 取 `mild`、`spicy`、`wild`。较高等级包含较低等级题目。`allowAdult` 为 false 时不发成人标记题目。

## 状态机

`lobby -> choosing -> answering -> resolving -> choosing`

- 自建房在大厅等待房主开始。
- 匹配房凑齐 4 人后直接进入 `choosing`。
- 当前玩家选择题目后进入 `answering`，完成或跳过后短暂进入 `resolving`，再轮到下一位。
- 超时自动跳过，不消耗主动跳过次数。
- 主动离开立即离座。断线保留座位，超过宽限期后离座；房主离座时移交给最早加入且仍在场的玩家。
- 游戏中少于 2 人时回到大厅。

房间码来自 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。产品不设固定人数，服务端用 `ROOM_SAFETY_CAP` 防止单个房间耗尽广播资源，默认 64。

## 错误码

`bad_request`、`unauthorized`、`not_found`、`forbidden`、`conflict`、`rate_limited`、`room_full`、`wrong_phase`、`not_your_turn`、`already_used`、`nickname_rejected`、`insufficient_players`、`not_ready`、`no_prompt`。
