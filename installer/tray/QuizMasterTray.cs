// QuizMaster FW – Starter mit Symbol im Infobereich der Taskleiste (installierte Version).
// Startet den Node-Server ohne sichtbares Fenster, öffnet die Verwaltung und bietet ein Menü:
// Verwaltung öffnen, Teilnehmer-Adresse kopieren, Protokoll, Daten-Ordner, Beenden.
// Wird beim MSI-Build mit dem in Windows enthaltenen C#-Compiler (csc, .NET Framework 4) übersetzt –
// daher nur C#-5-Sprachmittel (kein $"…", kein ?.).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("QuizMaster FW")]
[assembly: System.Reflection.AssemblyProduct("QuizMaster FW")]

static class Programm
{
    [STAThread]
    static void Main()
    {
        bool erste;
        using (var mutex = new Mutex(true, "Local\\QuizMasterFW_Tray", out erste))
        {
            if (!erste)
            {
                // Läuft schon: nur die Verwaltung im Browser öffnen
                Pfade.OeffneUrl("http://localhost:" + Pfade.LesePort() + "/admin.html");
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayKontext());
        }
    }
}

static class Pfade
{
    public static readonly string Programm = AppDomain.CurrentDomain.BaseDirectory;
    public static readonly string Node = Path.Combine(Programm, @"node\node.exe");
    public static readonly string App = Path.Combine(Programm, "app");
    // QMFW_DATA_DIR überschreibt den Datenordner (für Tests); QMFW_TEST=1 öffnet keinen Browser
    public static readonly string Daten = Environment.GetEnvironmentVariable("QMFW_DATA_DIR")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuizMasterFW");
    static readonly bool test = Environment.GetEnvironmentVariable("QMFW_TEST") == "1";
    public static readonly string Config = Path.Combine(Daten, "config.json");
    public static readonly string Protokoll = Path.Combine(Daten, "server.log");

    public static int LesePort()
    {
        try
        {
            var m = Regex.Match(File.ReadAllText(Config), "\"port\"\\s*:\\s*(\\d+)");
            if (m.Success) return int.Parse(m.Groups[1].Value);
        }
        catch { }
        return 3000;
    }

    public static string LeseVersion()
    {
        try
        {
            var m = Regex.Match(File.ReadAllText(Path.Combine(App, "package.json")), "\"version\"\\s*:\\s*\"([^\"]+)\"");
            if (m.Success) return m.Groups[1].Value;
        }
        catch { }
        return "";
    }

    public static void OeffneUrl(string url)
    {
        if (test) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }
}

class TrayKontext : ApplicationContext
{
    readonly NotifyIcon symbol = new NotifyIcon();
    readonly ToolStripMenuItem titelEintrag = new ToolStripMenuItem();
    readonly ToolStripMenuItem teilnehmerEintrag = new ToolStripMenuItem();
    readonly SynchronizationContext ui;
    readonly Queue<string> letzteZeilen = new Queue<string>();
    readonly object sperre = new object();
    readonly string version = Pfade.LeseVersion();

    Process server;
    StreamWriter protokoll;
    string adminUrl;
    string teilnehmerUrl;
    bool bereit;
    bool laeuftBereits;
    bool beendet;

    public TrayKontext()
    {
        ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();

        var menue = new ContextMenuStrip();
        titelEintrag.Text = "QuizMaster FW " + version + " – startet …";
        titelEintrag.Enabled = false;
        menue.Items.Add(titelEintrag);
        menue.Items.Add(new ToolStripSeparator());
        var verwaltung = new ToolStripMenuItem("Verwaltung öffnen", null, delegate { OeffneVerwaltung(); });
        verwaltung.Font = new Font(verwaltung.Font, FontStyle.Bold);
        menue.Items.Add(verwaltung);
        teilnehmerEintrag.Text = "Teilnehmer-Adresse kopieren";
        teilnehmerEintrag.Enabled = false;
        teilnehmerEintrag.Click += delegate { KopiereTeilnehmerAdresse(); };
        menue.Items.Add(teilnehmerEintrag);
        menue.Items.Add(new ToolStripSeparator());
        menue.Items.Add(new ToolStripMenuItem("Server-Protokoll anzeigen", null, delegate { ZeigeProtokoll(); }));
        menue.Items.Add(new ToolStripMenuItem("Daten-Ordner öffnen (Quizze, config.json)", null, delegate { OeffneDaten(); }));
        menue.Items.Add(new ToolStripSeparator());
        menue.Items.Add(new ToolStripMenuItem("Beenden", null, delegate { BeendenNachfragen(); }));

        symbol.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        symbol.Text = "QuizMaster FW – startet …";
        symbol.ContextMenuStrip = menue;
        symbol.DoubleClick += delegate { OeffneVerwaltung(); };
        symbol.Visible = true;

        StarteServer();
    }

    // ---------- Server ----------

    void StarteServer()
    {
        try
        {
            Directory.CreateDirectory(Pfade.Daten);
            protokoll = new StreamWriter(Pfade.Protokoll, false, new UTF8Encoding(false));
            protokoll.AutoFlush = true;
            protokoll.WriteLine("QuizMaster FW " + version + " – gestartet " + DateTime.Now.ToString("dd.MM.yyyy HH:mm:ss"));
        }
        catch { protokoll = null; }

        if (!File.Exists(Pfade.Node))
        {
            Fehler("Die Node.js-Laufzeit fehlt:\n" + Pfade.Node + "\n\nBitte QuizMaster FW neu installieren.");
            return;
        }

        var psi = new ProcessStartInfo(Pfade.Node, "\"" + Path.Combine(Pfade.App, @"server\index.js") + "\"");
        psi.WorkingDirectory = Pfade.App;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;
        psi.EnvironmentVariables["QMFW_DATA_DIR"] = Pfade.Daten;
        psi.EnvironmentVariables["QMFW_CONFIG"] = Pfade.Config;
        psi.EnvironmentVariables.Remove("QMFW_BROWSER"); // Browser öffnet dieses Programm selbst
        psi.EnvironmentVariables["QMFW_TRAY"] = "1";

        server = new Process();
        server.StartInfo = psi;
        server.EnableRaisingEvents = true;
        server.OutputDataReceived += Zeile;
        server.ErrorDataReceived += Zeile;
        server.Exited += delegate { ui.Post(delegate { ServerBeendet(); }, null); };
        try
        {
            server.Start();
            Auftrag.Zuordnen(server); // Node endet automatisch mit diesem Programm (auch bei Absturz)
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            Fehler("Der Server konnte nicht gestartet werden:\n" + ex.Message);
        }
    }

    void Zeile(object sender, DataReceivedEventArgs e)
    {
        if (e.Data == null) return;
        string z = e.Data;
        lock (sperre)
        {
            if (protokoll != null) { try { protokoll.WriteLine(z); } catch { } }
            letzteZeilen.Enqueue(z);
            while (letzteZeilen.Count > 25) letzteZeilen.Dequeue();
        }
        var m = Regex.Match(z, @"Quizleiter \(dieser Rechner\):\s*(http\S+)");
        if (m.Success) adminUrl = m.Groups[1].Value;
        m = Regex.Match(z, @"Teilnehmer im WLAN:\s*(http\S+)");
        if (m.Success && teilnehmerUrl == null) teilnehmerUrl = m.Groups[1].Value;
        if (z.Contains("läuft bereits")) laeuftBereits = true;
        else if (z.TrimStart().StartsWith("Beenden")) ui.Post(delegate { Bereit(); }, null); // letzte Zeile der Startmeldung
    }

    void Bereit()
    {
        if (bereit || beendet) return;
        bereit = true;
        string kurz = "QuizMaster FW " + version + " läuft";
        symbol.Text = kurz.Length > 63 ? kurz.Substring(0, 63) : kurz;
        titelEintrag.Text = kurz;
        if (teilnehmerUrl != null)
        {
            teilnehmerEintrag.Text = "Teilnehmer-Adresse kopieren: " + teilnehmerUrl.Replace("http://", "");
            teilnehmerEintrag.Enabled = true;
        }
        symbol.ShowBalloonTip(6000, "QuizMaster FW läuft",
            (teilnehmerUrl != null ? "Teilnehmer: " + teilnehmerUrl + "\n" : "") +
            "Der Server läuft im Hintergrund. Beenden: Rechtsklick auf dieses Symbol → Beenden.", ToolTipIcon.Info);
        OeffneVerwaltung();
    }

    void ServerBeendet()
    {
        if (beendet) return;
        if (laeuftBereits)
        {
            // Ein anderer Server (z. B. zweites Konto oder Konsolenfenster) belegt den Port
            OeffneVerwaltung();
            Schliessen();
            return;
        }
        string letzte;
        lock (sperre) letzte = string.Join("\n", letzteZeilen.ToArray());
        MessageBox.Show("Der QuizMaster-Server wurde unerwartet beendet.\n\nLetzte Meldungen:\n" + letzte +
            "\n\nDas vollständige Protokoll steht in:\n" + Pfade.Protokoll,
            "QuizMaster FW", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Schliessen();
    }

    // ---------- Menü ----------

    void OeffneVerwaltung()
    {
        Pfade.OeffneUrl(adminUrl ?? ("http://localhost:" + Pfade.LesePort() + "/admin.html"));
    }

    void KopiereTeilnehmerAdresse()
    {
        if (teilnehmerUrl == null) return;
        try
        {
            Clipboard.SetText(teilnehmerUrl);
            symbol.ShowBalloonTip(3000, "Adresse kopiert", teilnehmerUrl, ToolTipIcon.Info);
        }
        catch { }
    }

    void ZeigeProtokoll()
    {
        try { Process.Start("notepad.exe", "\"" + Pfade.Protokoll + "\""); } catch { }
    }

    void OeffneDaten()
    {
        try { Process.Start("explorer.exe", "\"" + Pfade.Daten + "\""); } catch { }
    }

    void BeendenNachfragen()
    {
        var antwort = MessageBox.Show(
            "QuizMaster FW beenden?\n\nDie Handys verlieren die Verbindung. Ein laufendes Spiel wird abgebrochen – " +
            "seine Ergebnisse werden nur gespeichert, wenn es vorher beendet wurde (Siegerehrung oder „Spiel beenden“).\n\n" +
            "Quizze, Info-Folien und gespeicherte Ergebnisse bleiben erhalten.",
            "QuizMaster FW beenden", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (antwort == DialogResult.Yes) Schliessen();
    }

    void Fehler(string text)
    {
        MessageBox.Show(text, "QuizMaster FW", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Schliessen();
    }

    void Schliessen()
    {
        if (beendet) return;
        beendet = true;
        try
        {
            if (server != null && !server.HasExited)
            {
                server.Kill();
                server.WaitForExit(3000);
            }
        }
        catch { }
        lock (sperre)
        {
            if (protokoll != null)
            {
                try { protokoll.WriteLine("Beendet " + DateTime.Now.ToString("dd.MM.yyyy HH:mm:ss")); protokoll.Dispose(); } catch { }
                protokoll = null;
            }
        }
        symbol.Visible = false;
        symbol.Dispose();
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        // Auch beim Abmelden/Herunterfahren das Symbol entfernen
        symbol.Visible = false;
        base.ExitThreadCore();
    }
}

// Windows-„Auftrag“ (Job Object): Wird dieses Programm beendet – auch über den Task-Manager –,
// beendet Windows den Node-Server automatisch mit. Vom Server gestartete Programme (z. B. Browser)
// bleiben davon unberührt (SILENT_BREAKAWAY_OK).
static class Auftrag
{
    const int ExtendedLimitInformation = 9;
    const uint KILL_ON_JOB_CLOSE = 0x2000;
    const uint SILENT_BREAKAWAY_OK = 0x1000;
    static IntPtr handle = IntPtr.Zero;

    [StructLayout(LayoutKind.Sequential)]
    struct BASIC_LIMIT
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct EXTENDED_LIMIT
    {
        public BASIC_LIMIT Basic;
        public IO_COUNTERS Io;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attribute, string name);

    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref EXTENDED_LIMIT info, uint length);

    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    public static void Zuordnen(Process p)
    {
        try
        {
            if (handle == IntPtr.Zero)
            {
                handle = CreateJobObject(IntPtr.Zero, null);
                var info = new EXTENDED_LIMIT();
                info.Basic.LimitFlags = KILL_ON_JOB_CLOSE | SILENT_BREAKAWAY_OK;
                SetInformationJobObject(handle, ExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT)));
            }
            AssignProcessToJobObject(handle, p.Handle);
        }
        catch { }
    }
}
