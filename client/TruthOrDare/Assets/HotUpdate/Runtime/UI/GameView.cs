using UnityEngine;
using UnityEngine.UIElements;

namespace Game.HotUpdate
{
    public sealed class GameView : MonoBehaviour
    {
        UIDocument document;
        AppController app;
        string signature = "";

        public static void Ensure(AppController controller)
        {
            var view = controller.GetComponent<GameView>();
            if (view == null) view = controller.gameObject.AddComponent<GameView>();
            view.app = controller;
            view.EnsureDocument();
        }

        public static void Render(AppController controller)
        {
            Ensure(controller);
            controller.GetComponent<GameView>().Redraw(true);
        }

        void EnsureDocument()
        {
            if (document != null) return;
            document = gameObject.AddComponent<UIDocument>();
            var panel = ScriptableObject.CreateInstance<PanelSettings>();
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.referenceResolution = new Vector2Int(1080, 1920);
            panel.match = 0.5f;
            document.panelSettings = panel;
        }

        void Update()
        {
            if (app == null) return;
            var wide = Screen.width > Screen.height;
            if (document != null && document.panelSettings != null)
            {
                document.panelSettings.referenceResolution = wide ? new Vector2Int(1920, 1080) : new Vector2Int(1080, 1920);
            }
            Redraw(false);
        }

        void Redraw(bool force)
        {
            var next = app.PlayerId + "|" + app.Status + "|" + app.Banner + "|" + app.Matching + "|" + app.QueueSize + "|" + app.ContentLevel + "|" + app.AllowAdult + "|" + (app.Room == null ? "" : app.Room.revision.ToString());
            if (!force && next == signature) return;
            signature = next;
            var root = document.rootVisualElement;
            root.Clear();
            root.style.flexGrow = 1;
            root.style.backgroundColor = new Color(0.08f, 0.09f, 0.14f);
            root.style.alignItems = Align.Center;
            root.style.justifyContent = Justify.Center;
            root.style.unityFont = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var page = Column();
            page.style.width = Length.Percent(100);
            page.style.maxWidth = Screen.width > Screen.height ? 1100 : 760;
            page.style.flexGrow = 1;
            page.style.paddingLeft = 28;
            page.style.paddingRight = 28;
            page.style.paddingTop = 36;
            page.style.paddingBottom = 28;
            root.Add(page);

            if (string.IsNullOrEmpty(app.PlayerId)) Login(page);
            else if (app.Matching && app.Room == null) Match(page);
            else if (app.Room == null) Lobby(page);
            else if (app.Room.phase == "lobby") RoomLobby(page);
            else Play(page);
        }

        void Login(VisualElement page)
        {
            page.Add(Title("真心话大冒险"));
            page.Add(Body("输入昵称即可开始。支持自建房间和 4 人自动匹配。"));
            var nick = Input(string.IsNullOrEmpty(app.Nickname) ? "" : app.Nickname);
            page.Add(nick);
            page.Add(Button("进入大厅", () => app.SubmitLogin(nick.value)));
            page.Add(Note(app.Banner));
        }

        void Lobby(VisualElement page)
        {
            page.Add(Title("大厅"));
            page.Add(Body(app.Nickname + " · " + app.Status));
            page.Add(Note(app.Banner));
            Settings(page);
            page.Add(Button("创建房间", app.CreateRoom));
            var code = Input("");
            page.Add(code);
            page.Add(Button("加入房间", () => app.JoinRoom(code.value)));
            page.Add(Button("自动匹配（4 人）", app.StartMatch));
        }

        void Match(VisualElement page)
        {
            page.Add(Title("匹配中"));
            page.Add(Body("已排队 " + Mathf.Max(app.QueueSize, 1) + " / " + GameRules.MatchSize));
            page.Add(Note("凑齐 4 人后会自动开始。"));
            page.Add(Button("取消匹配", app.CancelMatch));
        }

        void RoomLobby(VisualElement page)
        {
            page.Add(Title("房间 " + app.Room.code));
            page.Add(Body((app.Room.kind == "match" ? "匹配房" : "自建房") + " · 安全上限 " + app.Room.safetyCap + " 人"));
            page.Add(Note(app.Banner));
            if (app.Room.hostId == app.PlayerId) Settings(page);
            page.Add(Players(true));
            var me = GameRules.Find(app.Room, app.PlayerId);
            page.Add(Button(me != null && me.ready ? "取消准备" : "准备", () => app.SetReady(me == null || !me.ready)));
            if (GameRules.CanStart(app.Room, app.PlayerId)) page.Add(Button("开始游戏", app.StartGame));
            page.Add(Button("补齐 4 名机器人", () => app.FillBots(false)));
            if (app.Room.hostId == app.PlayerId) page.Add(Button("机器人开局", () => app.FillBots(true)));
            page.Add(Chat());
            page.Add(Button("离开房间", app.LeaveRoom));
        }

        void Play(VisualElement page)
        {
            var current = GameRules.Find(app.Room, app.Room.currentPlayerId);
            page.Add(Title(GameRules.PhaseLabel(app.Room)));
            page.Add(Body("轮到 " + (current == null ? "下一位" : current.nickname)));
            page.Add(Note(app.Banner));
            if (app.Room.lastResolution != null)
            {
                var resolution = app.Room.lastResolution;
                var prompt = resolution.prompt == null ? "本回合没有题目" : resolution.prompt.text;
                page.Add(Card(resolution.nickname + (resolution.outcome == "completed" ? " 完成了" : " 跳过了") + "\n" + prompt));
            }
            if (app.Room.currentPrompt != null && app.Room.phase != "choosing") page.Add(Card(app.Room.currentPrompt.text));
            if (GameRules.CanChoose(app.Room, app.PlayerId))
            {
                page.Add(Button("真心话", () => app.Choose("truth")));
                page.Add(Button("大冒险", () => app.Choose("dare")));
            }
            if (GameRules.CanComplete(app.Room, app.PlayerId)) page.Add(Button("我完成了", app.CompleteTurn));
            if (GameRules.CanSkip(app.Room, app.PlayerId)) page.Add(Button("跳过（每局一次）", app.SkipTurn));
            page.Add(Players(false));
            page.Add(Chat());
            page.Add(Button("离开房间", app.LeaveRoom));
        }

        void Settings(VisualElement page)
        {
            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.marginBottom = 12;
            row.Add(Choice("轻松", "mild"));
            row.Add(Choice("热辣", "spicy"));
            row.Add(Choice("大胆", "wild"));
            page.Add(row);
            var adult = new Toggle("包含更私密的题目") { value = app.AllowAdult };
            adult.RegisterValueChangedCallback(change => app.SetAdult(change.newValue));
            adult.style.color = Color.white;
            adult.style.marginBottom = 16;
            page.Add(adult);
        }

        Button Choice(string label, string level)
        {
            var button = new Button(() => app.SelectLevel(level)) { text = label };
            Paint(button, app.ContentLevel == level ? new Color(1f, 0.35f, 0.48f) : new Color(0.2f, 0.24f, 0.34f));
            button.style.flexGrow = 1;
            button.style.marginRight = 8;
            button.style.height = 64;
            return button;
        }

        VisualElement Players(bool canKick)
        {
            var box = Card("");
            box.Clear();
            foreach (var player in app.Room.players)
            {
                if (player == null) continue;
                var row = new VisualElement();
                row.style.flexDirection = FlexDirection.Row;
                row.style.justifyContent = Justify.SpaceBetween;
                row.style.marginBottom = 8;
                var text = player.nickname + (player.isHost ? " · 房主" : "") + (player.ready ? " · 已准备" : "") + (player.connected ? "" : " · 离线");
                row.Add(Body(text));
                if (canKick && app.Room.hostId == app.PlayerId && player.id != app.PlayerId)
                {
                    var id = player.id;
                    row.Add(Button("移出", () => app.Kick(id)));
                }
                box.Add(row);
            }
            return box;
        }

        VisualElement Chat()
        {
            var box = Card("聊天");
            var scroll = new ScrollView();
            scroll.style.maxHeight = 220;
            if (app.Room.chat != null)
            {
                foreach (var message in app.Room.chat)
                {
                    if (message == null) continue;
                    scroll.Add(Body(message.nickname + "：" + message.text));
                }
            }
            box.Add(scroll);
            var input = Input("");
            box.Add(input);
            box.Add(Button("发送", () => app.SendChat(input.value)));
            return box;
        }

        static Label Title(string text)
        {
            var label = new Label(text);
            label.style.fontSize = 42;
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            label.style.color = Color.white;
            label.style.marginBottom = 8;
            label.style.whiteSpace = WhiteSpace.Normal;
            return label;
        }

        static Label Body(string text)
        {
            var label = new Label(text);
            label.style.fontSize = 24;
            label.style.color = new Color(0.9f, 0.92f, 0.96f);
            label.style.whiteSpace = WhiteSpace.Normal;
            label.style.marginBottom = 8;
            return label;
        }

        static Label Note(string text)
        {
            var label = Body(string.IsNullOrEmpty(text) ? " " : text);
            label.style.color = new Color(1f, 0.78f, 0.42f);
            return label;
        }

        static VisualElement Card(string text)
        {
            var box = Column();
            box.style.backgroundColor = new Color(0.14f, 0.16f, 0.24f);
            box.style.borderTopLeftRadius = 18;
            box.style.borderTopRightRadius = 18;
            box.style.borderBottomLeftRadius = 18;
            box.style.borderBottomRightRadius = 18;
            box.style.paddingLeft = 18;
            box.style.paddingRight = 18;
            box.style.paddingTop = 16;
            box.style.paddingBottom = 16;
            box.style.marginBottom = 16;
            if (!string.IsNullOrEmpty(text)) box.Add(Body(text));
            return box;
        }

        static VisualElement Column()
        {
            var element = new VisualElement();
            element.style.flexDirection = FlexDirection.Column;
            return element;
        }

        static TextField Input(string value)
        {
            var field = new TextField { value = value };
            field.style.height = 64;
            field.style.fontSize = 24;
            field.style.marginBottom = 12;
            field.style.backgroundColor = new Color(0.16f, 0.18f, 0.26f);
            field.style.color = Color.white;
            return field;
        }

        static Button Button(string text, System.Action click)
        {
            var button = new Button(click) { text = text };
            Paint(button, new Color(1f, 0.35f, 0.48f));
            button.style.height = 72;
            button.style.marginBottom = 12;
            button.style.fontSize = 26;
            return button;
        }

        static void Paint(Button button, Color color)
        {
            button.style.backgroundColor = color;
            button.style.color = Color.white;
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            button.style.borderTopLeftRadius = 16;
            button.style.borderTopRightRadius = 16;
            button.style.borderBottomLeftRadius = 16;
            button.style.borderBottomRightRadius = 16;
        }
    }
}
