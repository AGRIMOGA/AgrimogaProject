import { useState, useEffect, useMemo } from "react";
import { loadJSON, saveJSON } from "@/Lib/storage";
import { Share2, Package2, Calculator } from "lucide-react";
import { useI18n } from "@/i18n/context";

const LS_KEY = "agrimoga:prices:v2";

const MARKET_PRESETS = {
  fraise: { min: 8, avg: 12, max: 18, unitKgPerBox: 5, label: {ar:"فراولة",fr:"Fraise",en:"Strawberry"} },
  framboise: { min: 35, avg: 50, max: 70, unitKgPerBox: 2, label: {ar:"فرامبواز",fr:"Framboise",en:"Raspberry"} },
  avocat: { min: 10, avg: 16, max: 24, unitKgPerBox: 10, label: {ar:"أفوكادو",fr:"Avocat",en:"Avocado"} },
};

const DEFAULT = {
  crop: "fraise",
  price: 12,
  yieldKg: 100,
  boxesCount: "",
  wasteMode: "kg",
  wasteKg: 0,
  wasteBoxes: "",
  costTransport: 200,
  costLabor: 100,
  costPackaging: 0,
  costOther: 0,
  commissionDh: 0,
  usePreset: true,
};

export default function Prices() {
  const s0 = loadJSON(LS_KEY, DEFAULT);
  const [f, setF] = useState(s0);
  const { t, lang } = useI18n();

  useEffect(() => saveJSON(LS_KEY, f), [f]);

  useEffect(() => {
    if (f.usePreset) setF((x) => ({ ...x, price: MARKET_PRESETS[f.crop].avg }));
  }, [f.crop, f.usePreset]);

  useEffect(() => {
    const kgPerBox = MARKET_PRESETS[f.crop].unitKgPerBox;
    if (f.boxesCount !== "" && !Number.isNaN(+f.boxesCount)) {
      setF((x) => ({ ...x, yieldKg: +f.boxesCount * kgPerBox }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.boxesCount, f.crop]);

  const wasteKgComputed = useMemo(() => {
    if (f.wasteMode === "kg") return +f.wasteKg || 0;
    const kgPerBox = MARKET_PRESETS[f.crop].unitKgPerBox;
    const boxes = +f.wasteBoxes || 0;
    return boxes * kgPerBox;
  }, [f.wasteMode, f.wasteKg, f.wasteBoxes, f.crop]);

  const calc = useMemo(() => {
    const sellableKg = Math.max(0, (f.yieldKg || 0) - wasteKgComputed);
    const gross = sellableKg * (f.price || 0);
    const baseCosts =
      (f.costTransport || 0) + (f.costLabor || 0) + (f.costPackaging || 0) + (f.costOther || 0);
    const commission = f.commissionDh || 0;
    const totalCosts = baseCosts + commission;
    const net = gross - totalCosts;
    const breakEvenPrice = sellableKg > 0 ? totalCosts / sellableKg : 0;
    return { sellableKg, gross, baseCosts, commission, totalCosts, net, breakEvenPrice };
  }, [f, wasteKgComputed]);

  const scenarios = useMemo(() => {
    const p = MARKET_PRESETS[f.crop];
    const sellableKg = Math.max(0, (f.yieldKg || 0) - wasteKgComputed);
    const baseCosts =
      (f.costTransport || 0) + (f.costLabor || 0) + (f.costPackaging || 0) + (f.costOther || 0);
    const commission = f.commissionDh || 0;
    return ["min", "avg", "max"].map((k) => {
      const price = p[k];
      const gross = sellableKg * price;
      const net = gross - (baseCosts + commission);
      const label = t(`sc.${k}`);
      return { label, price, net };
    });
  }, [f, wasteKgComputed, t]);

  const cropLabel = MARKET_PRESETS[f.crop].label[lang] || MARKET_PRESETS[f.crop].label.ar;
  const shareText =
`${t('tab.prices').toUpperCase()} - AGRIMOGA
${t('prices.crop')}: ${cropLabel}
${t('prices.pricePerKg')}: ${f.price} MAD/kg
${t('prices.res.sellable')}: ${fmt(calc.sellableKg)} kg
${t('prices.res.net')}: ${fmt(calc.net)} MAD
(${t('prices.res.breakeven')}: ${calc.breakEvenPrice.toFixed(2)} MAD/kg)`;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t('prices.title')}</h3>

      <div className="grid3">
        <div>
          <label className="label">{t('prices.crop')}</label>
          <select className="input" value={f.crop} onChange={(e)=>setF({ ...f, crop: e.target.value })}>
            <option value="fraise">🍓 {MARKET_PRESETS.fraise.label[lang]}</option>
            <option value="framboise">🫐 {MARKET_PRESETS.framboise.label[lang]}</option>
            <option value="avocat">🥑 {MARKET_PRESETS.avocat.label[lang]}</option>
          </select>
        </div>

        <div>
          <label className="label">{t('prices.pricePerKg')}</label>
          <div className="flex items-center gap-2">
            <input className="input" type="number" min={0} step={0.5}
              value={f.price} onChange={(e)=>setF({ ...f, price:+e.target.value })} disabled={f.usePreset}/>
            <select className="input" value={f.usePreset ? "avg" : "custom"}
              onChange={(e)=>setF({
                ...f,
                usePreset: e.target.value !== "custom",
                price: e.target.value === "custom" ? f.price : (MARKET_PRESETS[f.crop][e.target.value])
              })}>
              <option value="min">{t('prices.marketPreset.min')}</option>
              <option value="avg">{t('prices.marketPreset.avg')}</option>
              <option value="max">{t('prices.marketPreset.max')}</option>
              <option value="custom">{t('prices.marketPreset.custom')}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label"><Package2 size={14} style={{marginInlineEnd:6}}/>{t('prices.boxToKg')}</label>
          <input className="input" type="number" min={0} placeholder={t('prices.boxesCount')}
            value={f.boxesCount} onChange={(e)=>setF({ ...f, boxesCount:e.target.value })}/>
        </div>
      </div>

      <div className="grid3 section">
        <NumInput label={t('prices.yield')} value={f.yieldKg} onChange={(v)=>setF({ ...f, yieldKg:v })}/>
        <div>
          <label className="label">{t('prices.waste')}</label>
          <div className="flex items-center gap-2">
            <select className="input" value={f.wasteMode} onChange={(e)=>setF({ ...f, wasteMode:e.target.value })} style={{maxWidth:140}}>
              <option value="kg">{t('prices.waste.kg')}</option>
              <option value="boxes">{t('prices.waste.boxes')}</option>
            </select>
            {f.wasteMode === 'kg' ? (
              <input className="input" type="number" min={0} value={f.wasteKg}
                onChange={(e)=>setF({ ...f, wasteKg:+e.target.value || 0 })} placeholder={t('prices.waste.kg')}/>
            ) : (
              <input className="input" type="number" min={0} value={f.wasteBoxes}
                onChange={(e)=>setF({ ...f, wasteBoxes:e.target.value })} placeholder={t('prices.waste.boxes')}/>
            )}
          </div>
          <p className="muted" style={{marginTop:6}}>
            = {fmt((f.wasteMode==='kg'? (+f.wasteKg||0) : (+f.wasteBoxes||0)*MARKET_PRESETS[f.crop].unitKgPerBox))} kg
          </p>
        </div>
        <NumInput label={t('prices.commissionDh')} value={f.commissionDh} onChange={(v)=>setF({ ...f, commissionDh:v })}/>
      </div>

      <div className="grid4 section">
        <NumInput label={t('prices.cost.transport')} value={f.costTransport} onChange={(v)=>setF({ ...f, costTransport:v })}/>
        <NumInput label={t('prices.cost.labor')} value={f.costLabor} onChange={(v)=>setF({ ...f, costLabor:v })}/>
        <NumInput label={t('prices.cost.packaging')} value={f.costPackaging} onChange={(v)=>setF({ ...f, costPackaging:v })}/>
        <NumInput label={t('prices.cost.other')} value={f.costOther} onChange={(v)=>setF({ ...f, costOther:v })}/>
      </div>

      <div className="grid3 section">
        <KPI title={t('prices.res.sellable')} value={`${fmt(calc.sellableKg)} kg`}/>
        <KPI title={t('prices.res.gross')} value={`${fmt(calc.gross)} MAD`}/>
        <KPI title={t('prices.res.net')} value={`${fmt(calc.net)} MAD`} big/>
      </div>

      <div className="grid3">
        <Pill title={t('prices.res.baseCosts')} value={`${fmt(calc.baseCosts)} MAD`}/>
        <Pill title={t('prices.res.commission')} value={`${fmt(calc.commission)} MAD`}/>
        <Pill title={t('prices.res.breakeven')} value={`${calc.breakEvenPrice.toFixed(2)} MAD/kg`} note={t('prices.note.breakeven')}/>
      </div>

      <div className="section">
        <h4 style={{display:'flex',alignItems:'center',gap:6,margin:'0 0 8px 0'}}><Calculator size={16}/> {t('prices.scenarios.title')}</h4>
        <table className="table-auto w-full text-sm">
          <thead><tr><th></th><th>MAD/kg</th><th>MAD</th></tr></thead>
          <tbody>
            {scenarios.map((row,i)=>(
              <tr key={i}>
                <td>{row.label}</td>
                <td>{row.price}</td>
                <td style={{color: row.net<0?'#b91c1c':'#065F46'}}>{fmt(row.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="tab" onClick={()=>window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank")}>
        {t('share.whatsapp')}
      </button>
    </div>
  );
}

function NumInput({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" min={0} step={1} value={value} onChange={(e)=>onChange(+e.target.value||0)}/>
    </div>
  );
}
function KPI({ title, value, big }) {
  return (
    <div className="pill" style={{ padding: "14px 16px" }}>
      <div className="muted">{title}</div>
      <div style={{ fontWeight: 700, fontSize: big ? 24 : 18 }}>{value}</div>
    </div>
  );
}
function Pill({ title, value, note }) {
  return (
    <div className="pill">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div>{value}</div>
      {note && <div className="muted" style={{ marginTop: 6 }}>{note}</div>}
    </div>
  );
}
function fmt(n){return Number.isFinite(n)?Math.round(n).toLocaleString("fr-MA"):"0";}
