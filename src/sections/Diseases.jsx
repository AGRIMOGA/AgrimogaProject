import React, { useMemo, useState, useEffect } from 'react'
import { AlertTriangle, Thermometer, Droplets } from 'lucide-react'
import { loadJSON, saveJSON } from '@/lib/storage'
import { computeRisk } from '@/lib/risk'
import { useI18n } from '@/i18n/context'
import rawData from '../data/diseases.json'

const LS_KEY  = 'agrimoga:diseases'
const LS_RISK = 'agrimoga:diseaseRisk'

// ---- helpers: يدعمو الهيكل القديم والجديد ----
const pickLang = (val, lang) => {
  // val ممكن يكون string قديم أو object {ar,fr,en}
  if (!val) return ''
  if (typeof val === 'string') return val
  return val[lang] || val.ar || Object.values(val)[0] || ''
}
const pickLangArray = (arr, lang) => {
  // arr ممكن تكون ["A","B"] أو {ar:[".."], fr:[".."], en:[".."]}
  if (!arr) return []
  if (Array.isArray(arr)) return arr
  if (typeof arr === 'object') return arr[lang] || arr.ar || []
  return []
}

const FALLBACK = [
  {
    id: 'straw-botrytis',
    crop: 'fraise',
    name: { ar:'Botrytis (العفن الرمادي)', fr:'Botrytis (pourriture grise)', en:'Botrytis (gray mold)' },
    causes: {
      ar:['رطوبة عالية','بلل طويل للأوراق/الثمار'],
      fr:['Humidité élevée','Feuillage/fruits mouillés longtemps'],
      en:['High humidity','Leaves/fruits wet for long periods']
    },
    actions: {
      ar:['تحسين التهوية','إزالة الأجزاء المصابة','وقاية عند الذروة'],
      fr:['Améliorer l’aération','Enlever parties atteintes','Traitement préventif au pic'],
      en:['Improve ventilation','Remove infected parts','Preventive treatment at peak']
    },
    riskRules: { tempMin: 10, tempMax: 22, humidityMin: 85, rainProbMin: 40 }
  }
]

const INFO = {
  fraise: {
    risks: [
      { title: {ar:'العفن الرمادي', fr:'Pourriture grise', en:'Gray mold'}, hint: {ar:'خفّض البلل على الثمار واستعمل تغطية أرضية.', fr:'Réduire l’humidité sur fruits, paillage.', en:'Reduce wetness on fruit, use mulch.'} },
      { title: {ar:'عناكب حمراء', fr:'Acarien rouge', en:'Red spider mite'}, hint: {ar:'رش مائي خفيف ومراقبة ظهر الأوراق.', fr:'Brumisation légère, surveiller le revers des feuilles.', en:'Light misting, watch leaf underside.'} },
    ],
  },
  framboise: { risks: [] },
  avocat:    { risks: [] },
}

const riskToScore = (lvl) => (lvl === 'مرتفع' ? 2 : lvl === 'متوسط' ? 1 : 0)

export default function Diseases() {
  const { t, lang } = useI18n()

  const s0 = loadJSON(LS_KEY, { crop:'fraise', temp:28, rain:10, notes:'' })
  const [crop, setCrop]   = useState(['fraise','framboise','avocat'].includes(s0?.crop) ? s0.crop : 'fraise')
  const [temp, setTemp]   = useState(Number.isFinite(+s0?.temp) ? +s0.temp : 28)
  const [rain, setRain]   = useState(Number.isFinite(+s0?.rain) ? +s0.rain : 10)
  const [notes, setNotes] = useState(s0?.notes ?? '')

  useEffect(()=>{ saveJSON(LS_KEY, { crop, temp, rain, notes }) }, [crop,temp,rain,notes])

  // استعمل JSON ديالك، وإذا كان فارغ استعمل FALLBACK متعدد اللغات
  const data = (Array.isArray(rawData) && rawData.length) ? rawData : FALLBACK

  const diseases = useMemo(() => data.filter(d => d && d.crop === crop), [data, crop])

  const weather = { tempC: temp, humidityPct: rain, rainProbPct: rain, soilIsWet: false }

  const highest = useMemo(() => {
    let top = 'منخفض'
    for (const d of diseases) {
      const lvl = computeRisk(d, weather)
      if (riskToScore(lvl) > riskToScore(top)) top = lvl
      if (top === 'مرتفع') break
    }
    return top
  }, [diseases, weather])

  useEffect(()=>{
    saveJSON(LS_RISK, { score: riskToScore(highest), level: highest, crop, at: Date.now() })
  }, [highest, crop])

  const tips = INFO[crop] ?? { risks: [] }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>{t('diseases.title')}</h3>

      <div className="grid3">
        <div>
          <label className="label">{t('diseases.crop')}</label>
          <select value={crop} onChange={e=>setCrop(e.target.value)} className="input">
            <option value="fraise">🍓 {t('crop.fraise')}</option>
            <option value="framboise">🫐 {t('crop.framboise')}</option>
            <option value="avocat">🥑 {t('crop.avocat')}</option>
          </select>
        </div>
        <div>
          <label className="label"><Thermometer size={14}/> {t('diseases.temp')}: {temp}°C</label>
          <input type="range" min={-5} max={45} step={1} value={temp} onChange={e=>setTemp(+e.target.value)} style={{width:'100%'}}/>
        </div>
        <div>
          <label className="label"><Droplets size={14}/> {t('diseases.rain')}: {rain}%</label>
          <input type="range" min={0} max={100} step={5} value={rain} onChange={e=>setRain(+e.target.value)} style={{width:'100%'}}/>
        </div>
      </div>

      <div className="pill" style={{
        marginTop:12,
        borderColor: highest==='مرتفع' ? '#fecaca' : highest==='متوسط' ? '#fde68a' : '#bbf7d0',
        background:  highest==='مرتفع' ? '#fee2e2' : highest==='متوسط' ? '#fef9c3' : '#ecfdf5'
      }}>
        <p style={{display:'flex',alignItems:'center',gap:6,margin:0}}>
          <AlertTriangle size={16}/> {t('diseases.riskLevel')}: <b>{highest}</b>
        </p>
        <p className="muted" style={{marginTop:6}}>
          {lang==='fr' ? 'Varie selon température/humidité/pluie.' :
           lang==='en' ? 'Changes with temperature/humidity/rain.' :
                         'يتغيّر حسب الحرارة والرطوبة/احتمال الشتا.'}
        </p>
      </div>

      {/* كروت الأمراض */}
      {diseases.length > 0 ? (
        <div className="grid2 section">
          {diseases.map((d) => {
            const lvl = computeRisk(d, weather)
            const name    = pickLang(d.name, lang)
            const causes  = pickLangArray(d.causes, lang)
            const actions = pickLangArray(d.actions, lang)
            return (
              <div key={d.id || name} className="pill">
                <p style={{margin:'0 0 6px 0', fontWeight:600}}>
                  {name} — <span className="muted">
                    {lang==='fr' ? 'risque' : lang==='en' ? 'risk' : 'الخطر'}: {lvl}
                  </span>
                </p>
                {causes.length > 0 && (
                  <p className="muted" style={{margin:'0 0 6px 0'}}>
                    {lang==='fr' ? 'Causes' : lang==='en' ? 'Causes' : 'الأسباب'}: {causes.join(' • ')}
                  </p>
                )}
                {actions.length > 0 && (
                  <ul className="muted" style={{margin:0, paddingInlineStart:18}}>
                    {actions.slice(0,4).map((a,i)=><li key={i}>{a}</li>)}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="pill section">
          <p style={{margin:0}}>
            {lang==='fr' ? 'Pas de données maladies pour cette culture.' :
             lang==='en' ? 'No disease data for this crop.' :
                           'ما كايناش بيانات أمراض لهاذ المحصول حالياً.'}
          </p>
        </div>
      )}

      {/* نصائح عامة */}
      {Array.isArray(tips.risks) && tips.risks.length > 0 && (
        <div className="grid2 section">
          {tips.risks.map((r, i)=>(
            <div key={i} className="pill">
              <p style={{margin:'0 0 6px 0', fontWeight:600}}>{pickLang(r.title, lang)}</p>
              <p className="muted" style={{margin:0}}>{pickLang(r.hint, lang)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <label className="label">
          {lang==='fr' ? 'Notes terrain' : lang==='en' ? 'Field notes' : 'ملاحظات ميدانية'}
        </label>
        <textarea rows={3} className="input"
          placeholder={lang==='fr' ? 'Ex: taches, insectes...' : lang==='en' ? 'e.g., spots, insect...' : 'مثال: بقع/حشرة/اصفرار...'}
          value={notes} onChange={e=>setNotes(e.target.value)} />
      </div>
    </div>
  )
}
