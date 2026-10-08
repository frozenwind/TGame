using System;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Game.Main.EditorTools
{
    public static class TodBuild
    {
        [MenuItem("TruthOrDare/Build Hot Update Content")]
        public static void BuildContent()
        {
            BuildHotUpdate(EditorUserBuildSettings.activeBuildTarget);
        }

        [MenuItem("TruthOrDare/Build/Windows")]
        public static void BuildWindows() => BuildPlayer(BuildTarget.StandaloneWindows64, "TruthOrDare.exe");

        [MenuItem("TruthOrDare/Build/Android")]
        public static void BuildAndroid() => BuildPlayer(BuildTarget.Android, "TruthOrDare.apk");

        [MenuItem("TruthOrDare/Build/iOS")]
        public static void BuildIos() => BuildPlayer(BuildTarget.iOS, "Xcode");

        [MenuItem("TruthOrDare/Build/WebGL")]
        public static void BuildWeb() => BuildPlayer(BuildTarget.WebGL, "WebGL");

        public static void BuildPlayer(BuildTarget target, string fileName)
        {
            if (EditorUserBuildSettings.activeBuildTarget != target)
            {
                EditorUserBuildSettings.SwitchActiveBuildTarget(BuildPipeline.GetBuildTargetGroup(target), target);
            }
            ProjectSetup.Apply();
            BuildHotUpdate(target);
            var output = Path.Combine(RepoRoot(), "client", "build", target.ToString(), fileName);
            Directory.CreateDirectory(Path.GetDirectoryName(output) ?? output);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/Main.unity" },
                locationPathName = output,
                target = target,
                options = BuildOptions.None,
            });
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new Exception("Player 构建失败: " + report.summary.result);
            }
            Debug.Log("构建完成: " + output);
        }

        public static void BuildHotUpdate(BuildTarget target)
        {
            Invoke("HybridCLR.Editor.Commands.PrebuildCommand, HybridCLR.Editor", "GenerateAll");
            Invoke("HybridCLR.Editor.Commands.CompileDllCommand, HybridCLR.Editor", "CompileDll", target);
            var folder = HotUpdateFolder(target);
            var dll = Path.Combine(Directory.GetParent(Application.dataPath)?.FullName ?? "", "HybridCLRData", "HotUpdateDlls", folder, "Game.HotUpdate.dll");
            var streaming = Path.Combine(Application.streamingAssetsPath, "HotUpdate");
            Directory.CreateDirectory(streaming);
            var bytesName = "Game.HotUpdate.dll.bytes";
            if (File.Exists(dll)) File.Copy(dll, Path.Combine(streaming, bytesName), true);

            var publicDir = Path.Combine(RepoRoot(), "server", "public", folder, "hotupdate");
            Directory.CreateDirectory(publicDir);
            string hash = "";
            if (File.Exists(dll))
            {
                var destination = Path.Combine(publicDir, bytesName);
                File.Copy(dll, destination, true);
                using (var sha = SHA256.Create())
                {
                    hash = BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(destination))).Replace("-", "").ToLowerInvariant();
                }
            }

            var aotSource = Path.Combine(Directory.GetParent(Application.dataPath)?.FullName ?? "", "HybridCLRData", "AssembliesPostIl2CppStrip", folder);
            var aotTarget = Path.Combine(Application.streamingAssetsPath, "AOT");
            Directory.CreateDirectory(aotTarget);
            var aotNames = new System.Collections.Generic.List<string>();
            if (Directory.Exists(aotSource))
            {
                foreach (var file in Directory.GetFiles(aotSource, "*.dll"))
                {
                    var name = Path.GetFileName(file) + ".bytes";
                    File.Copy(file, Path.Combine(aotTarget, name), true);
                    aotNames.Add(name);
                }
            }

            Invoke("UnityEditor.AddressableAssets.Settings.AddressableAssetSettings, Unity.Addressables.Editor", "BuildPlayerContent");
            var version = "{\n  \"version\": \"" + PlayerSettings.bundleVersion + "\",\n  \"dll\": \"hotupdate/" + bytesName + "\",\n  \"catalog\": \"catalog_" + PlayerSettings.bundleVersion + ".json\",\n  \"hash\": \"" + hash + "\",\n  \"aot\": [" + string.Join(",", aotNames.ConvertAll(name => "\"" + name + "\"")) + "]\n}\n";
            File.WriteAllText(Path.Combine(Application.streamingAssetsPath, "version.json"), version);
            File.WriteAllText(Path.Combine(RepoRoot(), "server", "public", folder, "version.json"), version);
            EnsureAddressables();
            AssetDatabase.Refresh();
            Debug.Log("热更新内容已输出到 StreamingAssets 和 server/public/" + folder);
        }

        static void EnsureAddressables()
        {
            var settingsType = Type.GetType("UnityEditor.AddressableAssets.AddressableAssetSettingsDefaultObject, Unity.Addressables.Editor");
            var settings = settingsType?.GetProperty("Settings")?.GetValue(null);
            if (settings == null)
            {
                Debug.LogWarning("尚未导入 Addressables 包，跳过分组创建。导入后重新执行本菜单。");
                return;
            }
            var profile = settings.GetType().GetProperty("profileSettings")?.GetValue(settings);
            Debug.Log(profile == null ? "Addressables 设置已创建。" : "Addressables 设置已就绪。请把热更新 DLL 和 UI 资源放到 Remote 组，远程路径指向 http://服务器/content/[BuildTarget]。WebGL 资源使用 LZ4，HTTP 层提供 Brotli。");
        }

        static void Invoke(string typeName, string method, BuildTarget? target = null)
        {
            try
            {
                var type = Type.GetType(typeName);
                if (type == null) return;
                var flags = System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static;
                if (target.HasValue) type.GetMethod(method, flags, null, new[] { typeof(BuildTarget) }, null)?.Invoke(null, new object[] { target.Value });
                else type.GetMethod(method, flags)?.Invoke(null, null);
            }
            catch (Exception error)
            {
                Debug.LogWarning(method + " 未执行: " + error.Message);
            }
        }

        static string HotUpdateFolder(BuildTarget target)
        {
            return target switch
            {
                BuildTarget.StandaloneWindows64 => "StandaloneWindows64",
                BuildTarget.Android => "Android",
                BuildTarget.iOS => "iOS",
                BuildTarget.WebGL => "WebGL",
                _ => target.ToString(),
            };
        }

        static string RepoRoot()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
        }
    }
}
