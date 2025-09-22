// src/sections/Irrigation.jsx
import {useEffect, useMemo, useState} from 'react'
import { Thermometer, Wind, Droplets, MapPin, Locate, Share2, Calendar, AlertTriangle, RefreshCcw } from 'lucide-react'
import { loadJSON, saveJSON } from '@/lib/storage'
import { useI18n } from '@/i18n/context'

/* ===================== ثوابت بسيطة ===================== */

// مفاتيح التخزين
const LS_FORM = 'agrimoga:irrig:form'
const LS_LOG  = 'agrimoga:irrig:log'

// Presets حسب المحصول والزون
const PRESETS = {
  fraise: {
    name: 'فراولة',
    zones: {
      'Zone A — 100 m²': { plants: 400, drippersPerPlant: 4, dripperFlow: 2 }, // 2 L/h
      'Zone B — 250 m²': { plants: 900, drippersPerPlant: 4, dripperFlow: 2 },
    }
  },
  framboise: {
    name: 'فرامبواز',
    zones: {
      'Zone A — 100 m²': { plants: 250, drippersPerPlant: 2, dripperFlow: 2 },
      'Zone B — 250 m²': { plants: 600, drippersPerPlant: 2, dripperFlow: 2 },
    }
  },
  avocat: {
    name: 'أفوكا',
    zones: {
      'Zone A — 100 m²': { plants: 40, drippersPerPlant: 8, dripperFlow: 4 },  // 4 L/h
      'Zone B — 250 m²': { plants: 90, drippersPerPlant: 8, dripperFlow: 4 },
    }
  },
}

// حدود معقولة للمدخلات (Validation)
const LIMITS = {
  temp: [-5, 50],
  wind: [0, 90],
  rainPct: [0, 100],
  dripperFlow: [0.5, 16],   // L/h
  drippersPerPlant: [1, 16],
  pumpFlow: [0, 50000],     // L/h شبكة السقي
}

const kmh = v => `${v} كم/س`
const deg = v => `${v}°C`
const pct = v => `${v}%`

/* ===================== دوال مساعدة ===================== */

// تصحيح القيم داخل الحدود
function clamp(v, [min, max]) {
  if (Number.isNaN(+v)) return min
  return Math.min(max, Math.max(min, +v))
}

// حساب كمية السقي باللتر لليوم
function computeAdvice({crop, tempC, rainPct, windKmh, rainyTomorrow, plants, drippersPerPlant, dripperFlow}) {
  // طلب أساسي لكل محصول (لتر/نبتة/اليوم)
  const basePerPlant = crop === 'avocat' ? 18 : crop === 'framboise' ? 5 : 4

  let mult = 1
  // حرارة
  if (tempC >= 35) mult *= 1.45
  else if (tempC >= 30) mult *= 1.25
  else if (tempC <= 10) mult *= 0.8
  // ريح
  if (windKmh >= 40) mult *= 1.15
  // مطر/رطوبة
  if (rainPct >= 60) mult *= 0.35
  else if (rainPct >= 30) mult *= 0.65

  const litersPerPlant = basePerPlant * mult
  const totalLitersWanted = Math.max(0, Math.round(litersPerPlant * plants))

  // حد أمان: ما نتعدّوش الطاقة القصوى للنقّاطات
  const maxPerPlant = drippersPerPlant * dripperFlow // L/h لكل نبتة فساعة
  const maxToday = Math.round(maxPerPlant * plants)  // L فساعة
  const capped = Math.min(totalLitersWanted, Math.max(maxToday, 0))

  // قرار بسيط
  const postpone = rainyTomorrow && rainPct < 20
  const decision = postpone
    ? { title: 'ماتسقيش اليوم', reason: 'غداً متوقع الشتا — أجّل إلا ما كاينش عطش واضح.' }
    : capped < 0.5 * totalLitersWanted
      ? { title: 'سقي خفيف', reason: 'الرطوبة/الجو كافي نسبياً اليوم.' }
      : { title: 'سقي عادي', reason: 'ظروف متوسطة.' }

  return {
    liters: capped,
    perPlant: Math.round(litersPerPlant),
    decision,
    tip: crop === 'avocat'
      ? 'الأفوكا كيبغي سقي عميق وبعيد بين الدورات.'
      : crop === 'framboise'
        ? 'حافظ على توازن الماء وصرف جيد للجذور.'
        : 'سقي خفيف ومتكرر للفراولة لتفادي تعفن الجذور.',
  }
}

// مدة التشغيل = الكمية / صبيب الشبكة
function minutesFromFlow(totalLiters, pumpFlowLh) {
  if (!pumpFlowLh || pumpFlowLh <= 0) return null
  const hours = totalLiters / pumpFlowLh
  return Math.round(hours * 60)
}

// مشاركة واتساب
function buildShare({crop, zone, place, liters, minutes, tempC, windKmh, rainPct}) {
  const cropName = PRESETS[crop]?.name || crop
  const lines = [
    '💧 توصية السقي (Agrimoga)',
    `• المحصول: ${cropName}`,
    `• الزون: ${zone}`,
    `• المكان: ${place || 'غير محدد'}`,
    `• الطقس: حرارة ${tempC}°C • ريح ${windKmh} كم/س • رطوبة/مطر ${rainPct}%`,
    `• الكمية: ${liters} لتر${minutes ? ` • المدة ~ ${minutes} د` : ''}`,
  ]
  return `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`
}

/* ===================== الكومبونون ===================== */

export default function Irrigation(){
  const { t } = useI18n()

  // الحالة الابتدائية من التخزين المحلي
  const s0 = loadJSON(LS_FORM, {
    crop: 'fraise',
    zone: 'Zone A — 100 m²',
    pumpFlow: 800,                 // L/h
    tempC: 20, windKmh: 5, rainPct: 10, rainyTomorrow: false,
    place: '',
  })

  const [crop, setCrop] = useState(s0.crop)
  const [zone, setZone] = useState(s0.zone)
  const [pumpFlow, setPumpFlow] = useState(s0.pumpFlow)

  const [tempC, setTempC] = useState(s0.tempC)
  const [windKmh, setWindKmh] = useState(s0.windKmh)
  const [rainPct, setRainPct] = useState(s0.rainPct)
  const [rainyTomorrow, setRainyTomorrow] = useState(s0.rainyTomorrow)

  const [place, setPlace] = useState(s0.place)
  const [loadingWx, setLoadingWx] = useState(false)
  const [err, setErr] = useState('')

  // استرجاع الـ preset
  const preset = PRESETS[crop]?.zones?.[zone] || {plants: 300, drippersPerPlant: 2, dripperFlow: 2}

  // القيم القابلة للتعديل
  const [plants, setPlants] = useState(preset.plants)
  const [drippersPerPlant, setDrpPerPlant] = useState(preset.drippersPerPlant)
  const [dripperFlow, setDrpFlow] = useState(preset.dripperFlow)

  // كلما تبدّلات crop/zone رجّع قيم الـ preset
  useEffect(()=>{
    const p = PRESETS[crop]?.zones?.[zone]
    if (p) {
      setPlants(p.plants)
      setDrpPerPlant(p.drippersPerPlant)
      setDrpFlow(p.dripperFlow)
    }
  }, [crop, zone])

  // حفظ تلقائي
  useEffect(()=>{
    saveJSON(LS_FORM, { crop, zone, pumpFlow, tempC, windKmh, rainPct, rainyTomorrow, place })
  }, [crop, zone, pumpFlow, tempC, windKmh, rainPct, rainyTomorrow, place])

  // Validation خفيف على الطاير
  const vTemp     = clamp(tempC, LIMITS.temp)
  const vWind     = clamp(windKmh, LIMITS.wind)
  const vRain     = clamp(rainPct, LIMITS.rainPct)
  const vDrpFlow  = clamp(dripperFlow, LIMITS.dripperFlow)
  const vDrpN     = clamp(drippersPerPlant, LIMITS.drippersPerPlant)
  const vPlants   = Math.max(1, Math.round(plants || 1))
  const vPumpFlow = pumpFlow ? Math.max(0, +pumpFlow) : 0

  // حسابات
  const totalDrippers = vPlants * vDrpN
  const maxNetworkLh  = totalDrippers * vDrpFlow // L/h ممكن يخرّج من النقّاطات
  const advice = useMemo(()=>computeAdvice({
    crop, tempC:vTemp, rainPct:vRain, windKmh:vWind, rainyTomorrow,
    plants: vPlants, drippersPerPlant: vDrpN, dripperFlow: vDrpFlow
  }), [crop, vTemp, vRain, vWind, rainyTomorrow, vPlants, vDrpN, vDrpFlow])

  const minutes = minutesFromFlow(advice.liters, vPumpFlow)
  const shareURL = buildShare({crop, zone, place, liters: advice.liters, minutes, tempC:vTemp, windKmh:vWind, rainPct:vRain})

  // لوج سجل السقي
  const addLog = () => {
    const logs = loadJSON(LS_LOG, [])
    logs.unshift({
      at: Date.now(),
      crop, zone, place,
      liters: advice.liters,
      minutes,
      weather: { tempC:vTemp, windKmh:vWind, rainPct:vRain, rainyTomorrow }
    })
    saveJSON(LS_LOG, logs.slice(0, 200)) // نحتافظو بآخر 200 عملية
  }

  // GPS + OpenWeather (اختياري)
  const OWM = import.meta.env.VITE_OWM_API_KEY
  async function handleUseGPS(){
    setErr('')
    try{
      if (!navigator.geolocation) throw new Error('GPS غير مدعوم')
      setLoadingWx(true)
      const pos = await new Promise((ok, ko)=>{
        navigator.geolocation.getCurrentPosition(ok, e=>ko(new Error('رفض إذن GPS')))
      })
      const { latitude: lat, longitude: lon } = pos.coords

      if (!OWM) throw new Error('مفتاح الطقس غير مضاف (VITE_OWM_API_KEY)')

      const u = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=ar&appid=${OWM}`
      const res = await fetch(u)
      if (!res.ok) throw new Error('تعذّر جلب الطقس')
      const json = await res.json()

      setTempC(Math.round(json.main?.temp ?? vTemp))
      setWindKmh(Math.round((json.wind?.speed ?? vWind) * 3.6))
      setRainPct(Math.round((json.clouds?.all ?? vRain))) // تقريب بسيط
      setPlace(json.name || 'GPS')
    }catch(e){ setErr(e.message || 'مشكل غير متوقع') }
    finally{ setLoadingWx(false) }
  }

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>{t('irrigation.title') || 'السقي — توصيات دقيقة'}</h3>

      {/* المحصول والزون */}
      <div className="grid2">
        <div>
          <label className="label">المحصول</label>
          <select className="input" value={crop} onChange={e=>setCrop(e.target.value)}>
            <option value="fraise">🍓 فراولة</option>
            <option value="framboise">🫐 فرامبواز</option>
            <option value="avocat">🥑 أفوكا</option>
          </select>
        </div>
        <div>
          <label className="label">الزون</label>
          <select className="input" value={zone} onChange={e=>setZone(e.target.value)}>
            {Object.keys(PRESETS[crop].zones).map(z=> <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      </div>

      {/* إعداد الشبكة */}
      <div className="grid3 section">
        <div>
          <label className="label">عدد النباتات</label>
          <input className="input" type="number" value={vPlants}
                 onChange={e=>setPlants(+e.target.value||1)} min={1}/>
        </div>
        <div>
          <label className="label">عدد النقّاط/نبتة</label>
          <input className="input" type="number" value={vDrpN}
                 onChange={e=>setDrpPerPlant(+e.target.value||1)} min={1}/>
        </div>
        <div>
          <label className="label">صبيب النقّاط (L/h)</label>
          <input className="input" type="number" step="0.5" value={vDrpFlow}
                 onChange={e=>setDrpFlow(+e.target.value||0.5)} min={0.5}/>
        </div>
      </div>

      {/* الطقس السلايدرات */}
      <div className="grid3 section">
        <div>
          <label className="label"><Thermometer size={14}/> حرارة: {deg(vTemp)}</label>
          <input type="range" min={-5} max={50} step={1} value={vTemp}
                 onChange={e=>setTempC(+e.target.value)} style={{width:'100%'}}/>
        </div>
        <div>
          <label className="label"><Droplets size={14}/> رطوبة/مطر: {pct(vRain)}</label>
          <input type="range" min={0} max={100} step={5} value={vRain}
                 onChange={e=>setRainPct(+e.target.value)} style={{width:'100%'}}/>
        </div>
        <div>
          <label className="label"><Wind size={14}/> الريح: {kmh(vWind)}</label>
          <input type="range" min={0} max={90} step={1} value={vWind}
                 onChange={e=>setWindKmh(+e.target.value)} style={{width:'100%'}}/>
        </div>
      </div>

      {/* مطر غداً + الطقس عبر GPS */}
      <div className="grid2">
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <input id="rain-tom" type="checkbox" checked={rainyTomorrow} onChange={e=>setRainyTomorrow(e.target.checked)}/>
          <label htmlFor="rain-tom" className="label" style={{marginTop:0}}><Calendar size={14}/> مطر متوقع غداً؟</label>
        </div>
        <div style={{display:'flex', gap:8}}>
          <input className="input" placeholder="المكان (اختياري)" value={place} onChange={e=>setPlace(e.target.value)}/>
          <button className="btn" onClick={handleUseGPS} disabled={loadingWx} title="GPS + الطقس">
            <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
              {loadingWx ? <RefreshCcw size={16} className="animate-spin"/> : <Locate size={16}/>} جيّب الطقس
            </span>
          </button>
        </div>
      </div>
      {err && <p style={{color:'#dc2626', marginTop:6}}>⚠️ {err}</p>}

      {/* صبيب الشبكة */}
      <div className="grid2 section">
        <div>
          <label className="label">صبيب الشبكة (L/h)</label>
          <input className="input" type="number" value={vPumpFlow}
                 onChange={e=>setPumpFlow(+e.target.value||0)} min={0}/>
          <p className="muted" style={{marginTop:6}}>
            الصبيب الإجمالي الممكن من النقّاطات: <b>{Math.round(maxNetworkLh)}</b> L/h
          </p>
        </div>
        <div className="pill" style={{display:'flex',flexDirection:'column',justifyContent:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <AlertTriangle size={16}/> <b>معلومة</b>
          </div>
          <p className="muted" style={{margin:0}}>إذا كان صبيب الشبكة أقل بكثير من {Math.round(maxNetworkLh)} L/h، الوقت غادي يطول.</p>
        </div>
      </div>

      {/* التوصية */}
      <div className="card section" style={{background:'#f8fffb'}}>
        <h4 style={{marginTop:0}}>{advice.decision.title}</h4>
        <p className="muted" style={{marginTop:4}}>{advice.decision.reason}</p>

        <div className="grid3">
          <div className="pill">
            <p className="muted" style={{margin:0}}>الكمية المقترحة اليوم</p>
            <p style={{fontSize:28, fontWeight:700, margin:'6px 0 0 0'}}>{advice.liters} لتر</p>
            <p className="muted" style={{margin:0}}>(~ {advice.perPlant} L/نبتة)</p>
          </div>
          <div className="pill">
            <p className="muted" style={{margin:0}}>مدة التشغيل</p>
            <p style={{fontSize:28, fontWeight:700, margin:'6px 0 0 0'}}>
              {minutes != null ? `~ ${minutes} د` : '—'}
            </p>
            <p className="muted" style={{margin:0}}>بصبيب الشبكة: {vPumpFlow} L/h</p>
          </div>
          <div className="pill">
            <p className="muted" style={{margin:0}}>معطيات اليوم</p>
            <p style={{margin:'6px 0 0 0'}}>حرارة: {deg(vTemp)} • شتا: {pct(vRain)} • ريح: {kmh(vWind)}</p>
          </div>
        </div>

        <div className="pill" style={{marginTop:10, background:'#ecfdf5', borderColor:'#bbf7d0'}}>
          <p>💡 نصيحة: {advice.tip}</p>
        </div>

        <div style={{marginTop:12, display:'flex', gap:8}}>
          <button className="btn" onClick={addLog}><MapPin size={16}/> سجل العملية</button>
          <a className="btn" href={shareURL} target="_blank" rel="noreferrer">
            <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
              <Share2 size={16}/> شارك عبر WhatsApp
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}
