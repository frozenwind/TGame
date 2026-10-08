using UnityEngine;

namespace Game.HotUpdate
{
    public static class HotUpdateEntry
    {
        public static void Run(string serverUrl)
        {
            if (Object.FindObjectOfType<AppController>() != null) return;
            var host = new GameObject("TruthOrDare");
            Object.DontDestroyOnLoad(host);
            var app = host.AddComponent<AppController>();
            app.Configure(string.IsNullOrWhiteSpace(serverUrl) ? "http://127.0.0.1:8787" : serverUrl);
            var bootstrap = GameObject.Find("HotUpdateBootstrap");
            if (bootstrap != null) bootstrap.SendMessage("Handoff", SendMessageOptions.DontRequireReceiver);
        }
    }
}
