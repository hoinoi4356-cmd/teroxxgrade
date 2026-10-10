using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    const int Port = 3001;

    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string serverJs = Path.Combine(dir, "server.js");
        if (!File.Exists(serverJs))
        {
            MessageBox.Show("Файл server.js не знайдено поруч із програмою.\nЗапускник має лежати в папці discord.",
                "Месенджер", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        if (!PortOpen("127.0.0.1", Port))
        {
            string node = FindNode();
            if (node == null)
            {
                MessageBox.Show("Не знайдено Node.js.\nВстанови Node.js LTS із nodejs.org і спробуй знову.",
                    "Месенджер", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            StartNode(node, serverJs, dir);
            if (!WaitPort("127.0.0.1", Port, 25000))
            {
                MessageBox.Show("Сервер не запустився за 25 секунд.\nМожливо, порт 3001 уже зайнятий іншим процесом.",
                    "Месенджер", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        OpenWindow();
        return 0;
    }

    static void StartNode(string node, string serverJs, string dir)
    {
        var psi = new ProcessStartInfo(node, "\"" + serverJs + "\" --app");
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var p = new Process();
        p.StartInfo = psi;
        p.OutputDataReceived += (s, e) => { };
        p.ErrorDataReceived += (s, e) => { };
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
    }

    static string FindNode()
    {
        string[] guesses = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        };
        foreach (var g in guesses) if (File.Exists(g)) return g;
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var part in path.Split(';'))
        {
            if (part.Trim().Length == 0) continue;
            try { string c = Path.Combine(part.Trim(), "node.exe"); if (File.Exists(c)) return c; } catch { }
        }
        return null;
    }

    static string FindBrowser()
    {
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] c = {
            Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(pf, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(local, "Google", "Chrome", "Application", "chrome.exe")
        };
        foreach (var x in c) if (File.Exists(x)) return x;
        return null;
    }

    static void OpenWindow()
    {
        string url = "http://localhost:" + Port + "/";
        string browser = FindBrowser();
        string profile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MessengerApp", "profile");
        try { Directory.CreateDirectory(profile); } catch { }
        if (browser != null)
        {
            string argb = "--app=" + url +
                " --window-size=1280,820 --no-first-run --no-default-browser-check" +
                " --user-data-dir=\"" + profile + "\"";
            try
            {
                Process.Start(new ProcessStartInfo(browser, argb) { UseShellExecute = false });
                return;
            }
            catch { }
        }
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    static bool PortOpen(string host, int port)
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect(host, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(400)) return false;
                c.EndConnect(ar);
                return true;
            }
        }
        catch { return false; }
    }

    static bool WaitPort(string host, int port, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (PortOpen(host, port)) return true;
            Thread.Sleep(250);
        }
        return false;
    }
}
