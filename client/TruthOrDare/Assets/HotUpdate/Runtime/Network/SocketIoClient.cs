using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
#if !(UNITY_WEBGL && !UNITY_EDITOR)
using System.Net.WebSockets;
#endif

namespace Game.HotUpdate
{
    public sealed class SocketIoClient
    {
        readonly Dictionary<int, Action<string>> pending = new Dictionary<int, Action<string>>();
        readonly Queue<string> incoming = new Queue<string>();
        readonly Queue<string> outgoing = new Queue<string>();
        readonly object gate = new object();
        CancellationTokenSource lifetime;
#if !(UNITY_WEBGL && !UNITY_EDITOR)
        ClientWebSocket socket;
#endif
        int ackId;
        bool protocolReady;
        bool manualClose;
        bool connecting;
        float retryAt;
        int attempt;

        public bool AutoReconnect = true;
        public event Action Connected;
        public event Action<string> Disconnected;
        public event Action<string, string> EventReceived;

        public bool IsReady => protocolReady;

        public void Connect(string httpUrl, string token)
        {
            manualClose = false;
            Url = httpUrl;
            Token = token;
            Open();
        }

        public void Close()
        {
            manualClose = true;
            protocolReady = false;
            Shutdown("closed");
        }

        public void Emit(string name, string json, Action<string> ack)
        {
            var id = 0;
            if (ack != null)
            {
                id = ++ackId;
                pending[id] = ack;
            }
            var packet = id > 0
                ? "42" + id + "[\"" + name + "\"," + (json ?? "{}") + "]"
                : "42[\"" + name + "\"," + (json ?? "{}") + "]";
            Send(packet);
        }

        public void Pump()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGlSocket.Drain(Enqueue);
#endif
            while (true)
            {
                string message;
                lock (gate)
                {
                    if (incoming.Count == 0) break;
                    message = incoming.Dequeue();
                }
                Handle(message);
            }

            if (!protocolReady && !connecting && !manualClose && AutoReconnect && !string.IsNullOrEmpty(Url) && Time.realtimeSinceStartup >= retryAt && TransportDown())
            {
                Open();
            }
        }

        public string Url { get; private set; }
        public string Token { get; private set; }

        void Open()
        {
            Shutdown(null);
            connecting = true;
            protocolReady = false;
            lifetime = new CancellationTokenSource();
            var wsUrl = ToWebSocketUrl(Url);
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGlSocket.Create(wsUrl);
#else
            socket = new ClientWebSocket();
            var token = lifetime.Token;
            Task.Run(async () =>
            {
                try
                {
                    await socket.ConnectAsync(new Uri(wsUrl), token);
                    Enqueue("\u0001open");
                    var buffer = new byte[16384];
                    while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
                    {
                        var builder = new StringBuilder();
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                Enqueue("\u0001close");
                                return;
                            }
                            builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                        }
                        while (!result.EndOfMessage);
                        Enqueue(builder.ToString());
                    }
                }
                catch (Exception error)
                {
                    Enqueue("\u0001error:" + error.Message);
                }
            });
#endif
        }

        void Send(string packet)
        {
            if (!protocolReady)
            {
                lock (gate) outgoing.Enqueue(packet);
                return;
            }
            RawSend(packet);
        }

        void RawSend(string packet)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGlSocket.Send(packet);
#else
            if (socket == null || socket.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(packet);
            _ = socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, lifetime.Token);
#endif
        }

        void Handle(string message)
        {
            if (message == "\u0001open") return;
            if (message.StartsWith("\u0001close", StringComparison.Ordinal) || message.StartsWith("\u0001error", StringComparison.Ordinal))
            {
                protocolReady = false;
                connecting = false;
                if (!manualClose)
                {
                    attempt = Mathf.Min(attempt + 1, 4);
                    retryAt = Time.realtimeSinceStartup + Mathf.Min(8f, Mathf.Pow(2f, attempt));
                    Disconnected?.Invoke(message);
                }
                return;
            }

            if (message.Length == 0) return;
            if (message[0] == '0')
            {
                RawSend("40" + "{\"token\":\"" + Escape(Token) + "\"}");
                return;
            }
            if (message[0] == '2')
            {
                RawSend("3");
                return;
            }
            if (message[0] != '4' || message.Length < 2) return;
            ParseSocketPacket(message.Substring(1));
        }

        void ParseSocketPacket(string packet)
        {
            var type = packet[0] - '0';
            var index = 1;
            var ackStart = index;
            while (index < packet.Length && char.IsDigit(packet[index])) index++;
            var id = index > ackStart ? int.Parse(packet.Substring(ackStart, index - ackStart)) : -1;
            var data = index < packet.Length ? packet.Substring(index) : "";
            if (type == 0)
            {
                protocolReady = true;
                connecting = false;
                attempt = 0;
                FlushOutgoing();
                Connected?.Invoke();
                return;
            }
            if (type == 4)
            {
                Disconnected?.Invoke(data);
                return;
            }
            if (type == 3 && id >= 0 && pending.TryGetValue(id, out var callback))
            {
                pending.Remove(id);
                callback(Unwrap(data));
                return;
            }
            if (type != 2 || data.Length < 2) return;
            var nameStart = data.IndexOf('"');
            if (nameStart < 0) return;
            var nameEnd = data.IndexOf('"', nameStart + 1);
            if (nameEnd < 0) return;
            var name = data.Substring(nameStart + 1, nameEnd - nameStart - 1);
            var comma = data.IndexOf(',', nameEnd);
            var payload = comma < 0 ? "null" : data.Substring(comma + 1, data.LastIndexOf(']') - comma - 1);
            EventReceived?.Invoke(name, payload);
        }

        void FlushOutgoing()
        {
            lock (gate)
            {
                while (outgoing.Count > 0) RawSend(outgoing.Dequeue());
            }
        }

        void Enqueue(string message)
        {
            lock (gate) incoming.Enqueue(message);
        }

        void Shutdown(string reason)
        {
            lifetime?.Cancel();
            lifetime = null;
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGlSocket.Close();
#else
            if (socket != null)
            {
                try { socket.Abort(); } catch { /* 已关闭 */ }
                socket.Dispose();
                socket = null;
            }
#endif
            if (reason != null) Disconnected?.Invoke(reason);
        }

        bool TransportDown()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return !protocolReady;
#else
            return socket == null || socket.State != WebSocketState.Open;
#endif
        }

        static string ToWebSocketUrl(string httpUrl)
        {
            var uri = new Uri(httpUrl);
            var scheme = uri.Scheme == "https" ? "wss" : "ws";
            return scheme + "://" + uri.Authority + "/socket.io/?EIO=4&transport=websocket";
        }

        static string Escape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        static string Unwrap(string data)
        {
            if (string.IsNullOrEmpty(data)) return "{}";
            if (data.Length >= 2 && data[0] == '[' && data[data.Length - 1] == ']') return data.Substring(1, data.Length - 2);
            return data;
        }
    }

#if UNITY_WEBGL && !UNITY_EDITOR
    static class WebGlSocket
    {
        [System.Runtime.InteropServices.DllImport("__Internal")]
        static extern void TodSocketCreate(string url);
        [System.Runtime.InteropServices.DllImport("__Internal")]
        static extern void TodSocketSend(string message);
        [System.Runtime.InteropServices.DllImport("__Internal")]
        static extern void TodSocketClose();
        [System.Runtime.InteropServices.DllImport("__Internal")]
        static extern int TodSocketPoll(System.IntPtr buffer, int bufferSize);

        static System.IntPtr pointer;

        public static void Create(string url) => TodSocketCreate(url);
        public static void Send(string message) => TodSocketSend(message);
        public static void Close() => TodSocketClose();

        public static void Drain(Action<string> emit)
        {
            if (pointer == System.IntPtr.Zero) pointer = System.Runtime.InteropServices.Marshal.AllocHGlobal(65536);
            while (TodSocketPoll(pointer, 65536) == 1)
            {
                emit(System.Runtime.InteropServices.Marshal.PtrToStringUTF8(pointer));
            }
        }
    }
#endif
}
