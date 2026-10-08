using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEngine;
using UnityEngine.Networking;

namespace Game.Main
{
    public sealed class HotUpdateBootstrap : MonoBehaviour
    {
        const string HotAssembly = "Game.HotUpdate";
        string status = "正在启动真心话大冒险";
        bool handedOff;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Launch()
        {
            Application.runInBackground = true;
            if (FindObjectOfType<HotUpdateBootstrap>() != null) return;
            var host = new GameObject("HotUpdateBootstrap");
            DontDestroyOnLoad(host);
            host.AddComponent<HotUpdateBootstrap>();
        }

        void Start()
        {
            StartCoroutine(Boot());
        }

        public void Handoff()
        {
            handedOff = true;
            status = "";
        }

        void OnGUI()
        {
            if (handedOff) return;
            GUI.Label(new Rect(24, 24, Screen.width - 48, 80), status);
        }

        IEnumerator Boot()
        {
            var config = new AppConfig();
            yield return LoadJson(StreamingUrl("app-config.json"), json => JsonUtility.FromJsonOverwrite(json, config));
            if (string.IsNullOrWhiteSpace(config.serverUrl)) config.serverUrl = "http://127.0.0.1:8787";
            if (string.IsNullOrWhiteSpace(config.cdnUrl)) config.cdnUrl = config.serverUrl.TrimEnd('/') + "/content";

            var remote = new VersionManifest();
            yield return LoadJson(config.cdnUrl.TrimEnd('/') + "/version.json", json => JsonUtility.FromJsonOverwrite(json, remote));
            var local = new VersionManifest();
            yield return LoadJson(StreamingUrl("version.json"), json => JsonUtility.FromJsonOverwrite(json, local));
            var manifest = string.IsNullOrEmpty(remote.version) ? local : remote;

            var dllName = string.IsNullOrEmpty(manifest.dll) ? "hotupdate/Game.HotUpdate.dll.bytes" : manifest.dll;
            var dllPath = Path.Combine(Application.persistentDataPath, "hotupdate", "Game.HotUpdate.dll.bytes");
            if (!string.IsNullOrEmpty(remote.version) && remote.version != local.version)
            {
                status = "正在下载热更新 " + remote.version;
                yield return Download(config.cdnUrl.TrimEnd('/') + "/" + dllName, dllPath);
            }

            if (manifest.aot != null)
            {
                foreach (var file in manifest.aot)
                {
                    byte[] bytes = null;
                    yield return ReadBytes(StreamingUrl("AOT/" + file), value => bytes = value);
                    if (bytes != null) LoadMetadata(bytes);
                }
            }

            Assembly assembly = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(item => item.GetName().Name == HotAssembly);
            if (assembly == null)
            {
                status = "正在加载热更新程序集";
                byte[] dll = null;
                if (File.Exists(dllPath)) dll = File.ReadAllBytes(dllPath);
                else yield return ReadBytes(StreamingUrl(dllName), value => dll = value);
                if (dll == null)
                {
                    status = "没有找到热更新程序集。请在编辑器中直接运行，或先执行 TruthOrDare/Build Hot Update Content。";
                    yield break;
                }
                assembly = Assembly.Load(dll);
            }

            if (!string.IsNullOrEmpty(manifest.catalog))
            {
                ReloadCatalog(config.cdnUrl.TrimEnd('/') + "/" + manifest.catalog);
            }

            var entry = assembly.GetType("Game.HotUpdate.HotUpdateEntry");
            var run = entry?.GetMethod("Run", BindingFlags.Public | BindingFlags.Static);
            if (run == null)
            {
                status = "热更新入口不存在";
                yield break;
            }
            status = "正在进入游戏";
            run.Invoke(null, new object[] { config.serverUrl });
        }

        static IEnumerator LoadJson(string url, Action<string> apply)
        {
            using var request = UnityWebRequest.Get(url);
            yield return request.SendWebRequest();
            if (request.result == UnityWebRequest.Result.Success && !string.IsNullOrEmpty(request.downloadHandler.text))
            {
                apply(request.downloadHandler.text);
            }
        }

        static IEnumerator ReadBytes(string url, Action<byte[]> apply)
        {
            using var request = UnityWebRequest.Get(url);
            yield return request.SendWebRequest();
            if (request.result == UnityWebRequest.Result.Success) apply(request.downloadHandler.data);
        }

        static IEnumerator Download(string url, string path)
        {
            using var request = UnityWebRequest.Get(url);
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success) yield break;
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? Application.persistentDataPath);
            File.WriteAllBytes(path, request.downloadHandler.data);
        }

        static string StreamingUrl(string relative)
        {
            var path = Path.Combine(Application.streamingAssetsPath, relative).Replace("\\", "/");
            if (path.Contains("://")) return path;
            return "file://" + path;
        }

        static void LoadMetadata(byte[] bytes)
        {
            var api = Type.GetType("HybridCLR.RuntimeApi, HybridCLR.Runtime");
            var modeType = Type.GetType("HybridCLR.HomologousImageMode, HybridCLR.Runtime");
            if (api == null || modeType == null) return;
            var mode = Enum.Parse(modeType, "SuperSet");
            api.GetMethod("LoadMetadataForAOTAssembly")?.Invoke(null, new object[] { bytes, mode });
        }

        static void ReloadCatalog(string catalogUrl)
        {
            var addressables = Type.GetType("UnityEngine.AddressableAssets.Addressables, Unity.Addressables");
            var method = addressables?.GetMethod("LoadContentCatalogAsync", new[] { typeof(string), typeof(string) });
            method?.Invoke(null, new object[] { catalogUrl, null });
        }
    }

    [Serializable]
    public sealed class AppConfig
    {
        public string serverUrl = "http://127.0.0.1:8787";
        public string cdnUrl = "http://127.0.0.1:8787/content";
        public string version = "1.0.0";
    }

    [Serializable]
    public sealed class VersionManifest
    {
        public string version = "";
        public string dll = "";
        public string catalog = "";
        public string[] aot = Array.Empty<string>();
    }
}
