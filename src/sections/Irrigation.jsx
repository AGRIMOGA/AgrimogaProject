import { useEffect, useMemo, useState } from 'react'
import { MapPin, Thermometer, Wind, Droplets, Locate, RefreshCw, Share2, Info } from 'lucide-react'
import { loadJSON, saveJSON } from '@/lib/storage'

/* =========================
   التخزين + مفاتيح OpenWeather
========================= */
const LS_FORM = 'agrimoga:irrig:form'
const LS_WX   = 'agrimoga:irrig:wx'
const LS_LOG  = 'agrimoga:irrig:log' // سجل بسيط محلي

const OWM = {
  key: import.meta.env.VITE_OWM_API_KEY,
  forecast(lat, lon) {
    return `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=ar&appid=${this.key}`
  },
  revGeo(lat, lon) {
    return `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${this.key}`
  },
}

/* =========================
   Helpers
========================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function summarizeForecast(forecastJson) {
  const list = forecastJson?.list || []
  if (!list.length) return null
  const now = list[0]
  const temp = Math.round(now.main?.temp ?? 22)
  const wind = Math.round((now.wind?.speed ?? 3) * 3.6) // m/s → km/h
  const humidity = clamp(Math.round(now.main?.humidity ?? 50), 0, 100)
  const today = list.slice(0, 8)
  const tomorrow = list.slice(8, 16)
  const avg = arr => Math.round((arr.reduce((s, x) => s + (x.pop ?? 0), 0) / (arr.length || 1)) * 100)
  const popToday = avg(today)
  const popTomorrow = avg(tomorrow)
  const rainyTomorrow = popTomorrow >= 30
  return { temp, wind, humidity, popToday, rainyTomorrow }
}

function irrigationAdvice({ crop, area, temp, humidity, wind, rainyTomorrow, pumpFlowLh, emittersPerM2, emitterFlowLh }) {
  const basePer100m2 = crop === 'avocat' ? 400 : crop === 'framboise' ? 280 : 250
  let litersPer100m2 = basePer100m2
  if (temp >= 35) litersPer100m2 *= 1.4
  else if (temp >= 30) litersPer100m2 *= 1.2
  else if (temp <= 10) litersPer100m2 *= 0.8
  if (wind >= 35) litersPer100m2 *= 1.15
  if (humidity >= 75) litersPer100m2 *= 0.9
  if (rainyTomorrow && humidity >= 60) litersPer100m2 *= 0.6

  const liters = Math.max(0, Math.round((litersPer100m2 / 100) * area))
  const totalNetworkLh =
    Number(pumpFlowLh) > 0
      ? Number(pumpFlowLh)
      : Math.max(1, Math.round((emittersPerM2 * emitterFlowLh) * (area / 1)))
  const hours = liters / Math.max(totalNetworkLh, 1)
  const minutes = Math.max(1, Math.round(hours * 60))
  const tip =
    liters <= 120 ? '💡 سقي خفيف ومتكرر.'
    : rainyTomorrow ? '💡 متوقع المطر غداً — نقص شوية اليوم.'
    : '💡 راقب التربة، ما تغمّرش بزاف.'
  return { liters, minutes, tip }
}

/* =========================
   UI helpers (تصميم عمودي أنيق)
========================= */
function Section({ title, hint, children }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <label className="label" style={{ margin: 0 }}>{label}</label>
      <div>{children}</div>
    </div>
  )
}

/* =========================
   Component
========================= */
export default function Irrigation() {
  // الحقول الأساسية
  const init = loadJSON(LS_FORM, {
    crop: 'fraise',
    area: 100,
    zone: 'Zone A — 100 m²',
    pumpFlowLh: 0,
    emittersPerM2: 4,
    emitterFlowLh: 2,
    useGPS: true,
    placeName: '',
  })
  const [crop, setCrop] = useState(init.crop)
  const [area, setArea] = useState(init.area)
  const [zone, setZone] = useState(init.zone)
  const [pumpFlowLh, setPumpFlowLh] = useState(init.pumpFlowLh)
  const [emittersPerM2, setEmittersPerM2] = useState(init.emittersPerM2)
  const [emitterFlowLh, setEmitterFlowLh] = useState(init.emitterFlowLh)
  const [useGPS, setUseGPS] = useState(init.useGPS)
  const [placeName, setPlaceName] = useState(init.placeName)

  // الطقس
  const wx0 = loadJSON(LS_WX, { temp: 24, humidity: 50, wind: 10, rainyTomorrow: false, popToday: 0 })
  const [temp, setTemp] = useState(wx0.temp)
  const [humidity, setHumidity] = useState(wx0.humidity)
  const [wind, setWind] = useState(wx0.wind)
  const [rainyTomorrow, setRainyTomorrow] = useState(wx0.rainyTomorrow)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // سجل بسيط
  const [log, setLog] = useState(loadJSON(LS_LOG, []))

  useEffect(() => {
    saveJSON(LS_FORM, { crop, area, zone, pumpFlowLh, emittersPerM2, emitterFlowLh, useGPS, placeName })
  }, [crop, area, zone, pumpFlowLh, emittersPerM2, emitterFlowLh, useGPS, placeName])

  useEffect(() => {
    saveJSON(LS_WX, { temp, humidity, wind, rainyTomorrow, popToday: wx0.popToday })
  }, [temp, humidity, wind, rainyTomorrow])

  /* جلب الطقس */
  async function fetchWeatherByCoords(lat, lon) {
    setErr('')
    setLoading(true)
    try {
      if (!OWM.key) throw new Error('أضف VITE_OWM_API_KEY إلى .env.local وإلى Vercel.')
      const fr = await fetch(OWM.forecast(lat, lon))
      if (!fr.ok) throw new Error('تعذر جلب Forecast من OpenWeather')
      const forecast = await fr.json()
      const sum = summarizeForecast(forecast)
      if (!sum) throw new Error('Forecast فارغ')
      let place = placeName
      try {
        const rp = await fetch(OWM.revGeo(lat, lon))
        const arr = await rp.json()
        if (Array.isArray(arr) && arr[0]) {
          const el = arr[0]
          place = el.local_names?.ar || el.name || `${lat.toFixed(3)},${lon.toFixed(3)}`
        }
      } catch {}
      setTemp(sum.temp); setWind(sum.wind); setHumidity(sum.humidity); setRainyTomorrow(sum.rainyTomorrow); setPlaceName(place || '')
    } catch (e) {
      setErr(e.message || 'وقع خطأ أثناء جلب الطقس')
    } finally {
      setLoading(false)
    }
  }

  function useCurrentGPS() {
    if (!navigator.geolocation) { setErr('المتصفح لا يدعم GPS'); return }
    setErr(''); setLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
      () => { setErr('خاص ترخيص GPS'); setLoading(false) },
      { enableHighAccuracy: true, timeout: 12000 }
    )
  }

  useEffect(() => { if (useGPS) useCurrentGPS() }, [useGPS])

  /* حساب التوصية */
  const advice = useMemo(
    () => irrigationAdvice({
      crop,
      area: Number(area) || 0,
      temp, humidity, wind, rainyTomorrow,
      pumpFlowLh: Number(pumpFlowLh) || 0,
      emittersPerM2: Number(emittersPerM2) || 0,
      emitterFlowLh: Number(emitterFlowLh) || 0,
    }),
    [crop, area, temp, humidity, wind, rainyTomorrow, pumpFlowLh, emittersPerM2, emitterFlowLh]
  )

  /* حفظ في السجل */
  function addToLog() {
    const entry = {
      at: new Date().toLocaleString(),
      crop, area,
      liters: advice.liters,
      minutes: advice.minutes,
      place: placeName || 'غير محدد',
      wx: { temp, humidity, wind, rainyTomorrow }
    }
    const next = [entry, ...log].slice(0, 50)
    setLog(next)
    saveJSON(LS_LOG, next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 1) الطقس */}
      <Section title="الطقس" hint={placeName ? <><MapPin size={14}/> {placeName}</> : null}>
        <Row label={<><Thermometer size={14}/> الحرارة</>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={-5} max={45} step={1} value={temp} onChange={e => setTemp(+e.target.value)} style={{ width: '100%' }} />
            <b>{temp}°C</b>
          </div>
        </Row>
        <Row label={<><Droplets size={14}/> الرطوبة / احتمال الشتا</>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={0} max={100} step={5} value={humidity} onChange={e => setHumidity(+e.target.value)} style={{ width: '100%' }} />
            <b>{humidity}%</b>
          </div>
        </Row>
        <Row label={<><Wind size={14}/> الريح</>}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={0} max={80} step={5} value={wind} onChange={e => setWind(+e.target.value)} style={{ width: '100%' }} />
            <b>{wind} كم/س</b>
          </div>
        </Row>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={useCurrentGPS} disabled={loading}>
            <Locate size={16}/> {loading ? 'كيجيب الطقس…' : 'GPS الآن'}
          </button>
          <button className="btn" onClick={() => setUseGPS(v => !v)}>
            <RefreshCw size={16}/> {useGPS ? 'تعطيل التحديث التلقائي' : 'تفعيل التحديث التلقائي'}
          </button>
          {err && <span style={{ color:'#dc2626', fontSize:12 }}>⚠️ {err}</span>}
        </div>
      </Section>

      {/* 2) المحصول والمساحة */}
      <Section title="المحصول والمساحة">
        <Row label="المحصول">
          <select value={crop} onChange={e => setCrop(e.target.value)} className="input">
            <option value="fraise">🍓 فراولة</option>
            <option value="framboise">🫐 فرامبواز</option>
            <option value="avocat">🥑 أفوكا</option>
          </select>
        </Row>
        <Row label="المساحة (م²)">
          <input type="number" className="input" value={area} min={10} step={10} onChange={e => setArea(e.target.value)} />
        </Row>
        <Row label="الزون / وصف">
          <input className="input" value={zone} onChange={e => setZone(e.target.value)} />
        </Row>
      </Section>

      {/* 3) شبكة الري */}
      <Section title="شبكة الري">
        <Row label="صبيب المضخة (L/h)">
          <input type="number" className="input" value={pumpFlowLh} min={0} step={50} onChange={e => setPumpFlowLh(e.target.value)} placeholder="0 = حسب النقاطات" />
        </Row>
        <Row label="نقاطات/م²">
          <input type="number" className="input" value={emittersPerM2} min={0} step={1} onChange={e => setEmittersPerM2(e.target.value)} />
        </Row>
        <Row label="صبيب النقاطة (L/h)">
          <input type="number" className="input" value={emitterFlowLh} min={0} step={0.5} onChange={e => setEmitterFlowLh(e.target.value)} />
        </Row>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          إن كان صبيب المضخة أكبر من 0 سيتم اعتماده، وإلا فالحساب حسب عدد النقاطات × صبيبها.
        </div>
      </Section>

      {/* 4) الحساب والتوصية */}
      <Section title="التوصية">
        <div className="pill" style={{ borderColor:'#dbeafe', background:'#eff6ff', marginBottom:8 }}>
          <p className="muted" style={{ margin:0 }}>الكمية المقترحة</p>
          <p style={{ fontSize:28, fontWeight:700, margin:'6px 0 0 0' }}>{advice.liters} لتر</p>
        </div>
        <div className="pill" style={{ borderColor:'#bbf7d0', background:'#ecfdf5', marginBottom:8 }}>
          <p className="muted" style={{ margin:0 }}>مدة التشغيل التقريبية</p>
          <p style={{ fontSize:28, fontWeight:700, margin:'6px 0 0 0' }}>~ {advice.minutes} دقيقة</p>
        </div>
        <div className="pill" style={{ borderColor:'#fde68a', background:'#fef9c3' }}>
          <p style={{ margin:0 }}><Info size={14}/> {advice.tip}</p>
        </div>
      </Section>

      {/* 5) أزرار المشاركة/الحفظ */}
      <Section title="الإجراءات">
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button
            className="btn"
            onClick={() => {
              const msg = `💧 توصية السقي
• المحصول: ${crop === 'fraise' ? 'فراولة' : crop === 'avocat' ? 'أفوكا' : 'فرامبواز'}
• المكان: ${placeName || 'غير محدد'}
• المعطيات: حرارة ${temp}°C • رطوبة ${humidity}% • ريح ${wind} كم/س
• الكمية: ${advice.liters} لتر لمساحة ${area} م²
• المدة: ~${advice.minutes} دقيقة
(Agrimoga)`
              const url = `https://wa.me/?text=${encodeURIComponent(msg)}`
              window.open(url, '_blank')
            }}
          >
            <Share2 size={16}/> شارك عبر WhatsApp
          </button>

          <button className="btn" onClick={addToLog}>حفظ في السجل</button>
        </div>
      </Section>

      {/* 6) سجل السقي */}
      <Section title="سجل السقي" hint="محفوظ محلياً في المتصفح">
        {log.length === 0 ? (
          <div className="muted">لا توجد مدخلات.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {log.map((e, i) => (
              <div key={i} className="pill" style={{ display:'grid', gridTemplateColumns:'1fr auto', alignItems:'center' }}>
                <div>
                  <div style={{ fontWeight:600 }}>{e.liters} L • ~{e.minutes} د</div>
                  <div className="muted" style={{ fontSize:12 }}>
                    {e.at} — {e.crop} • {e.area} م² • {e.place} — طقس: {e.wx.temp}°C/{e.wx.humidity}%/{e.wx.wind}كم/س {e.wx.rainyTomorrow ? '— شتا غداً' : ''}
                  </div>
                </div>
                <button
                  className="input"
                  onClick={() => { const next = log.filter((_, j) => j !== i); setLog(next); saveJSON(LS_LOG, next) }}
                  style={{ cursor:'pointer' }}
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
