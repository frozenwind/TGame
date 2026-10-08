using System;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace Game.Main.EditorTools
{
    [InitializeOnLoad]
    public static class ProjectSetup
    {
        static ProjectSetup()
        {
            Apply();
        }

        [MenuItem("TruthOrDare/Apply Player Settings")]
        public static void Apply()
        {
            try
            {
                ApplyUnsafe();
            }
            catch (Exception error)
            {
                Debug.LogWarning("播放器设置未完全应用: " + error.Message);
            }
        }

        static void ApplyUnsafe()
        {
            PlayerSettings.companyName = "tgame";
            PlayerSettings.productName = "真心话大冒险";
            PlayerSettings.bundleVersion = "1.0.0";
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
            PlayerSettings.allowedAutorotateToPortrait = true;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = true;
            PlayerSettings.allowedAutorotateToLandscapeLeft = true;
            PlayerSettings.allowedAutorotateToLandscapeRight = true;
            PlayerSettings.runInBackground = true;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Standalone, "com.tgame.truthordare");
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.tgame.truthordare");
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.iOS, "com.tgame.truthordare");
            SetBackend(NamedBuildTarget.Standalone);
            SetBackend(NamedBuildTarget.Android);
            SetBackend(NamedBuildTarget.iOS);
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel25;
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            TrySet("activeInputHandler", 1);
            TryWebGlCompression();
        }

        static void SetBackend(NamedBuildTarget target)
        {
            PlayerSettings.SetScriptingBackend(target, ScriptingImplementation.IL2CPP);
            if (!Enum.TryParse("NET_Unity_4_8", out ApiCompatibilityLevel level) && !Enum.TryParse("NET_Standard_2_1", out level)) return;
            PlayerSettings.SetApiCompatibilityLevel(target, level);
        }

        static void TrySet(string property, int value)
        {
            var method = typeof(PlayerSettings).GetMethod("SetPropertyInt", new[] { typeof(string), typeof(int), typeof(BuildTargetGroup) });
            method?.Invoke(null, new object[] { property, value, BuildTargetGroup.Unknown });
        }

        static void TryWebGlCompression()
        {
            var webgl = typeof(PlayerSettings).GetNestedType("WebGL");
            var property = webgl?.GetProperty("compressionFormat");
            if (property == null) return;
            var brotli = Enum.Parse(property.PropertyType, "Brotli");
            property.SetValue(null, brotli);
        }
    }
}
