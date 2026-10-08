using System;

namespace Game.HotUpdate
{
    // 字段名与 shared/protocol.ts 保持一致，供 Unity JsonUtility 直接反序列化。
    [Serializable]
    public sealed class PromptDto
    {
        public string id = "";
        public string kind = "";
        public string level = "";
        public bool adult;
        public string category = "";
        public string text = "";
    }

    [Serializable]
    public sealed class PlayerDto
    {
        public string id = "";
        public string nickname = "";
        public bool ready;
        public bool connected;
        public int skipsRemaining;
        public bool isHost;
        public bool isBot;
    }

    [Serializable]
    public sealed class ChatDto
    {
        public string id = "";
        public string playerId = "";
        public string nickname = "";
        public string text = "";
        public int at;
    }

    [Serializable]
    public sealed class ResolutionDto
    {
        public string playerId = "";
        public string nickname = "";
        public string choice;
        public PromptDto prompt;
        public string outcome = "";
        public int at;
    }

    [Serializable]
    public sealed class RoomDto
    {
        public string id = "";
        public string code = "";
        public string kind = "";
        public string hostId = "";
        public string contentLevel = "mild";
        public bool allowAdult;
        public string phase = "lobby";
        public PlayerDto[] players = Array.Empty<PlayerDto>();
        public int revision;
        public string[] turnOrder = Array.Empty<string>();
        public int turnIndex;
        public string currentPlayerId;
        public string currentChoice;
        public PromptDto currentPrompt;
        public ResolutionDto lastResolution;
        public int safetyCap;
        public int createdAt;
        public ChatDto[] chat = Array.Empty<ChatDto>();
    }

    [Serializable]
    public sealed class StateEvent
    {
        public int revision;
        public string reason = "";
        public RoomDto room;
    }

    [Serializable]
    public sealed class ApiErrorDto
    {
        public string code = "";
        public string message = "";
    }

    [Serializable]
    public sealed class MatchStatusDto
    {
        public bool queued;
        public int size;
        public int needed = 4;
    }

    [Serializable]
    public sealed class AckDto
    {
        public bool ok;
        public ApiErrorDto error;
        public RoomDto snapshot;
        public MatchStatusDto match;
    }

    [Serializable]
    public sealed class GuestDto
    {
        public bool ok;
        public string playerId = "";
        public string sessionToken = "";
        public string nickname = "";
        public ApiErrorDto error;
    }
}
