import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Brain, FileClock, Fingerprint, Save, RotateCcw, type LucideIcon } from "lucide-react";
import { api, type PromptFileMeta } from "../lib/eva";

const META: Record<string, { icon: LucideIcon; designation: string; blurb: string; accent?: boolean }> = {
  SOUL: { icon: Brain, designation: "ЛИЧНОСТЬ ЕВЫ · ОТДЕЛЬНО", blurb: "Голос, характер и принципы Евы. Не превращается в USER.md и не присваивает историю Ивана.", accent: true },
  MEMORY: { icon: FileClock, designation: "РАБОЧЕЕ СОСТОЯНИЕ", blurb: "То, что держится на виду в каждом ходе. Правится и Евой, и тобой. В Studio не видно — это текст промпта." },
  USER: { icon: Fingerprint, designation: "СТАБИЛЬНОЕ ОБ ИВАНЕ", blurb: "Модель пользователя: кто ты, а не биография Евы." },
};

export default function PromptPane({ notify, onBack }: { notify: (m: string) => void; onBack: () => void }) {
  const [files, setFiles] = useState<PromptFileMeta[]>([]);
  const [active, setActive] = useState<string>("SOUL");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => { try { setFiles(await api.promptfiles()); } catch { /**/ } }, []);
  const loadFile = useCallback(async (key: string) => {
    setLoading(true); setActive(key);
    try { const d = await api.promptfileGet(key); setContent(d.content); setOriginal(d.content); }
    catch { setContent(""); setOriginal(""); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); loadFile("SOUL"); /* eslint-disable-next-line */ }, []);

  const dirty = content !== original;

  async function save() {
    setSaving(true);
    try {
      await api.promptfileWrite(active, content);
      setOriginal(content);
      notify(`${active}.md сохранён (бэкап сделан). Персона обновится со следующего хода.`);
      loadList();
    } catch { notify("Не удалось сохранить — файл под замком?"); }
    finally { setSaving(false); }
  }

  return (
    <div className="utility-screen">
      <div className="pane-topbar utility-topbar">
        <div className="pane-title-group"><span className="pane-eyebrow">EVA / ЛИЧНОСТЬ · ПРОМПТ-БЛОКНОТ</span><h1>Личность</h1></div>
        <button className="quiet-text-button" onClick={onBack}>К разговору <ArrowRight size={14} /></button>
      </div>
      <div className="utility-scroll">
        <div className="utility-content">
          <div className="utility-intro">
            <span className="section-index">EVA / 03</span>
            <h2>Кто это знает.</h2>
            <p>Файлы, которые входят в системный промпт КАЖДОГО хода. Правь их — и Ева меняется. Перед записью делается бэкап. Это редактор модели: SOUL.md — характер, USER.md — модель тебя, MEMORY.md — рабочее состояние.</p>
          </div>

          <div className="prompt-tabs">
            {["SOUL", "MEMORY", "USER"].map((key) => {
              const f = files.find((x) => x.key === key);
              const M = META[key];
              const Icon = M.icon;
              return (
                <button key={key} className={`prompt-tab ${active === key ? "prompt-tab-active" : ""} ${M.accent ? "prompt-tab-soul" : ""}`} onClick={() => loadFile(key)}>
                  <span className="prompt-tab-icon"><Icon size={16} /></span>
                  <span className="prompt-tab-copy"><strong>{key}.md</strong><small>{M.designation}</small></span>
                  <span className="prompt-tab-chars">{f ? `${(f.chars / 1000).toFixed(1)}k` : "—"}</span>
                </button>
              );
            })}
          </div>

          <p className="prompt-blurb">{META[active].blurb}</p>

          <div className={`prompt-editor ${META[active].accent ? "prompt-editor-soul" : ""}`}>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} disabled={loading} placeholder={loading ? "читаю файл…" : ""} />
          </div>

          <div className="prompt-actions">
            <span className="prompt-status">{dirty ? "● есть несохранённые правки" : "сохранено"} · {content.length} символов</span>
            <div className="prompt-buttons">
              <button className="mem-cancel" onClick={() => setContent(original)} disabled={!dirty}><RotateCcw size={14} /> Откатить</button>
              <button className="mem-save" onClick={save} disabled={!dirty || saving}><Save size={14} /> {saving ? "сохраняю…" : "Сохранить"}</button>
            </div>
          </div>

          <div className="identity-equation"><span>USER MODEL</span><strong>≠</strong><span>EVA PERSONA</span><small>Память о тебе не становится воспоминаниями Евы о собственной жизни.</small></div>
        </div>
      </div>
    </div>
  );
}
