import { useEffect, useMemo, useState } from "react";
import { loadJSON, saveJSON } from "@/Lib/storage";
import { useI18n } from "@/i18n/context";
import { FlaskConical } from "lucide-react";

const LS_KEY = "agrimoga:fert";

export default function Fertilization() {
  const { t } = useI18n();
  const s0 = loadJSON(LS_KEY, {
    crop: "fraise",
    n: 6, p: 3, k: 6,      // kg/ha (مثال)
    splitDays: 7,
    note: "",
  });

  const [crop, setCrop] = useState(s0.crop);
  const [n, setN] = useState(s0.n);
  const [p, setP] = useState(s0.p);
  const [k, setK] = useState(s0.k);
  const [splitDays, setSplitDays] = useState(s0.splitDays);
  const [note, setNote] = useState(s0.note);

  useEffect(()=> saveJSON(LS_KEY, { crop, n, p, k, splitDays, note }), [crop,n,p,k,splitDays,note]);

  const plan = useMemo(() => {
    const doses = 4; // نقسم على 4 دفعات كمثال
    return {
      doses,
      perDose: { n:(n/doses), p:(p/doses), k:(k/doses) }
    };
  }, [n,p,k]);

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>{t("fert.title")}</h3>

      <div className="grid3">
        <div>
          <label className="label">{t("fert.crop")}</label>
          <select className="input" value={crop} onChange={(e)=>setCrop(e.target.value)}>
            <option value="fraise">🍓 {t("crop.fraise")}</option>
            <option value="framboise">🫐 {t("crop.framboise")}</option>
            <option value="avocat">🥑 {t("crop.avocat")}</option>
          </select>
        </div>
        <NumInput label={t("fert.n")} value={n} onChange={setN}/>
        <NumInput label={t("fert.p")} value={p} onChange={setP}/>
      </div>

      <div className="grid3 section">
        <NumInput label={t("fert.k")} value={k} onChange={setK}/>
        <div>
          <label className="label">{t("fert.split")}</label>
          <div className="flex items-center gap-2">
            <input className="input" type="number" min={3} value={splitDays} onChange={(e)=>setSplitDays(+e.target.value||3)}/>
            <span className="pill">{t("fert.split.days")}</span>
          </div>
        </div>
        <div className="pill" style={{alignSelf:'end'}}>
          <p className="muted" style={{margin:0}}>{t("fert.plan")}</p>
          <p style={{margin:'6px 0 0 0', display:'flex', alignItems:'center', gap:8}}>
            <FlaskConical size={16}/>
            N {plan.perDose.n.toFixed(1)} / P {plan.perDose.p.toFixed(1)} / K {plan.perDose.k.toFixed(1)}
          </p>
        </div>
      </div>

      <div className="section">
        <label className="label">{t("fert.note.placeholder")}</label>
        <textarea className="input" rows={3} value={note} onChange={(e)=>setNote(e.target.value)} placeholder={t("fert.note.placeholder")}/>
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" min={0} step={0.5} value={value} onChange={(e)=>onChange(+e.target.value||0)}/>
    </div>
  );
}
