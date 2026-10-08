using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace Game.HotUpdate
{
    public sealed class AppController : MonoBehaviour
    {
        public string ServerUrl = "http://127.0.0.1:8787";
        public string PlayerId = "";
        public string Nickname = "";
        public string Token = "";
        public string ContentLevel = "mild";
        public bool AllowAdult;
        public bool Matching;
        public int QueueSize;
        public string Banner = "";
        public string Status = "未连接";
        public RoomDto Room;

        readonly SocketIoClient socket = new SocketIoClient();
        string viewKey = "";
        bool socketBound;

        public void Configure(string serverUrl)
        {
            ServerUrl = serverUrl.TrimEnd('/');
        }

        void Start()
        {
            Token = PlayerPrefs.GetString("tod.token", "");
            Nickname = PlayerPrefs.GetString("tod.nick", "");
            BindSocket();
            GameView.Ensure(this);
            if (!string.IsNullOrEmpty(Token) && !string.IsNullOrEmpty(Nickname)) StartCoroutine(Login(Nickname, Token));
            else GameView.Render(this);
        }

        void Update()
        {
            socket.Pump();
        }

        void OnDestroy()
        {
            socket.Close();
        }

        public void SubmitLogin(string nickname)
        {
            StartCoroutine(Login(nickname, Token));
        }

        public void CreateRoom()
        {
            Emit("room.create", JsonUtility.ToJson(Settings()));
        }

        public void JoinRoom(string code)
        {
            Emit("room.join", JsonUtility.ToJson(new CodePayload { code = (code ?? "").Trim().ToUpperInvariant() }));
        }

        public void StartMatch()
        {
            Matching = true;
            QueueSize = 1;
            Banner = "正在寻找 4 名玩家";
            Emit("match.enqueue", JsonUtility.ToJson(Settings()));
            GameView.Render(this);
        }

        public void CancelMatch()
        {
            Matching = false;
            Emit("match.cancel", "{}");
            GameView.Render(this);
        }

        public void LeaveRoom()
        {
            Emit("room.leave", "{}");
            Room = null;
            Matching = false;
            GameView.Render(this);
        }

        public void SetReady(bool ready)
        {
            Emit("room.ready", JsonUtility.ToJson(new ReadyPayload { ready = ready }));
        }

        public void StartGame()
        {
            Emit("room.start", "{}");
        }

        public void Kick(string playerId)
        {
            Emit("room.kick", JsonUtility.ToJson(new KickPayload { playerId = playerId }));
        }

        public void SelectLevel(string level)
        {
            ContentLevel = level;
            if (Room != null && Room.hostId == PlayerId && Room.phase == "lobby")
            {
                Emit("room.settings", JsonUtility.ToJson(Settings()));
            }
            GameView.Render(this);
        }

        public void SetAdult(bool allow)
        {
            AllowAdult = allow;
            if (Room != null && Room.hostId == PlayerId && Room.phase == "lobby")
            {
                Emit("room.settings", JsonUtility.ToJson(Settings()));
            }
        }

        public void SendChat(string text)
        {
            Emit("chat.send", JsonUtility.ToJson(new ChatPayload { text = text ?? "" }));
        }

        public void Choose(string choice)
        {
            Emit("game.choose", JsonUtility.ToJson(new ChoosePayload { choice = choice, requestId = Guid.NewGuid().ToString("N") }));
        }

        public void CompleteTurn()
        {
            Emit("game.complete", JsonUtility.ToJson(new RequestPayload { requestId = Guid.NewGuid().ToString("N") }));
        }

        public void SkipTurn()
        {
            Emit("game.skip", JsonUtility.ToJson(new RequestPayload { requestId = Guid.NewGuid().ToString("N") }));
        }

        public void FillBots(bool start)
        {
            StartCoroutine(Post("/api/dev/bots", JsonUtility.ToJson(new BotPayload { count = 4, start = start }), Token, ApplyHttpRoom, ShowError));
        }

        IEnumerator Login(string nickname, string existingToken)
        {
            Status = "正在登录";
            Banner = "";
            var payload = JsonUtility.ToJson(new GuestPayload { nickname = nickname, sessionToken = existingToken });
            yield return Post("/api/guest", payload, null, json =>
            {
                var guest = JsonUtility.FromJson<GuestDto>(json);
                if (guest == null || !guest.ok)
                {
                    ShowError(guest?.error?.message ?? "登录失败");
                    return;
                }
                PlayerId = guest.playerId;
                Nickname = guest.nickname;
                Token = guest.sessionToken;
                PlayerPrefs.SetString("tod.token", Token);
                PlayerPrefs.SetString("tod.nick", Nickname);
                PlayerPrefs.Save();
                Status = "正在连接";
                socket.Connect(ServerUrl, Token);
            }, ShowError);
        }

        void BindSocket()
        {
            if (socketBound) return;
            socketBound = true;
            socket.Connected += () =>
            {
                Status = "已连接";
                socket.Emit("room.sync", "{}", ApplyAck);
                GameView.Render(this);
            };
            socket.Disconnected += reason =>
            {
                Status = "连接中断，正在重试";
                Banner = reason;
                GameView.Render(this);
            };
            socket.EventReceived += (name, json) =>
            {
                if (name == "room.state" || name == "match.found")
                {
                    var state = JsonUtility.FromJson<StateEvent>(json);
                    if (state?.room == null) return;
                    var result = RoomReducer.Apply(Room, state.room, false);
                    if (result.Status == ReduceStatus.NeedsSync)
                    {
                        socket.Emit("room.sync", "{}", ApplyAck);
                        return;
                    }
                    if (result.Status == ReduceStatus.Accepted)
                    {
                        Room = result.Room;
                        Matching = false;
                        ContentLevel = Room.contentLevel;
                        AllowAdult = Room.allowAdult;
                    }
                }
                else if (name == "match.queued")
                {
                    var match = JsonUtility.FromJson<MatchStatusDto>(json);
                    Matching = match != null && match.queued;
                    QueueSize = match?.size ?? QueueSize;
                }
                else if (name == "kicked")
                {
                    Room = null;
                    Banner = "你已被移出房间";
                }
                else if (name == "game.error")
                {
                    var error = JsonUtility.FromJson<ApiErrorDto>(json);
                    Banner = error?.message ?? "操作失败";
                }
                GameView.Render(this);
            };
        }

        void Emit(string name, string json)
        {
            if (!socket.IsReady)
            {
                Banner = "尚未连接到服务器";
                GameView.Render(this);
                return;
            }
            socket.Emit(name, json, ApplyAck);
        }

        void ApplyAck(string json)
        {
            var ack = JsonUtility.FromJson<AckDto>(json);
            if (ack == null) return;
            if (!ack.ok)
            {
                ShowError(ack.error != null ? ack.error.message : "操作失败");
                return;
            }
            if (ack.match != null)
            {
                Matching = ack.match.queued;
                QueueSize = ack.match.size;
            }
            if (ack.snapshot != null && !string.IsNullOrEmpty(ack.snapshot.id))
            {
                var result = RoomReducer.Apply(Room, ack.snapshot, true);
                if (result.Status == ReduceStatus.Accepted) Room = result.Room;
                Matching = false;
            }
            GameView.Render(this);
        }

        void ApplyHttpRoom(string json)
        {
            var ack = JsonUtility.FromJson<AckDto>(json);
            if (ack != null && ack.snapshot != null && !string.IsNullOrEmpty(ack.snapshot.id))
            {
                Room = ack.snapshot;
                Matching = false;
            }
            GameView.Render(this);
        }

        void ShowError(string message)
        {
            Banner = message;
            Status = "请检查输入或网络";
            GameView.Render(this);
        }

        LevelPayload Settings()
        {
            return new LevelPayload { contentLevel = ContentLevel, allowAdult = AllowAdult };
        }

        IEnumerator Post(string path, string json, string bearer, Action<string> ok, Action<string> fail)
        {
            using var request = new UnityWebRequest(ServerUrl + path, UnityWebRequest.kHttpVerbPOST);
            var bytes = System.Text.Encoding.UTF8.GetBytes(json ?? "{}");
            request.uploadHandler = new UploadHandlerRaw(bytes);
            request.downloadHandler = new DownloadHandlerBuffer();
            request.SetRequestHeader("Content-Type", "application/json");
            if (!string.IsNullOrEmpty(bearer)) request.SetRequestHeader("Authorization", "Bearer " + bearer);
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                var body = request.downloadHandler.text;
                var parsed = string.IsNullOrEmpty(body) ? null : JsonUtility.FromJson<GuestDto>(body);
                fail(parsed?.error?.message ?? request.error);
                yield break;
            }
            ok(request.downloadHandler.text);
        }
    }

    [Serializable] sealed class GuestPayload { public string nickname; public string sessionToken; }
    [Serializable] sealed class LevelPayload { public string contentLevel; public bool allowAdult; }
    [Serializable] sealed class CodePayload { public string code; }
    [Serializable] sealed class ReadyPayload { public bool ready; }
    [Serializable] sealed class KickPayload { public string playerId; }
    [Serializable] sealed class ChatPayload { public string text; }
    [Serializable] sealed class ChoosePayload { public string choice; public string requestId; }
    [Serializable] sealed class RequestPayload { public string requestId; }
    [Serializable] sealed class BotPayload { public int count; public bool start; }
}
