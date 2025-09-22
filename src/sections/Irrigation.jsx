import { useEffect, useMemo, useState } from "react"
import { MapPin, Thermometer, Wind, Droplets, Bell, Share2, Locate, Cloud } from "lucide-react"
import { loadJSON, saveJSON } from "@/lib/storage"

// مفاتيح التخزين
const LS_FORM = "agrimoga:waterForm:v2"
const LS_LAST = "agrimoga:lastAdvice:v2"

// API مفتاح OpenWeather (من Vite env)
const OWM_KEY = import.meta.env.VITE_OWM_API_KEY

// --- Helpers صغيرة
async function geocodeCity(name) {
  const u = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(name)}&limit=1&appid=${OWM_KEY}`
  const r = await fetch(u)
  if (!r.ok) throw new Error("geo failed")
  const j = await r.json()
  if (!j?.length) throw new Error("not found")
  return { lat: j[0].lat, lon: j[0].lon, label: j[0].name }
}
async function fetchForecast(lat, lon) {
  const u = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=ar&appid=${OWM_KEY}`
  const r = await fetch(u)
  if (!r.ok) throw new Error("forecast failed")
  return await r.json()
}
function summarize(forecast) {
  const list = forecast?.list || []
  if (!list.length) return null
  const now = list[0]
  const temp = Math.round(now.main.temp)
  const wind = Math.round(now.wind.speed * 3.6)
  const popToday = Math.round(
    (list.slice(0, 8).reduce((s, it) => s + (it.pop || 0), 0) / Math.min(8, list.length)) * 100
  )
  const popTomorrow = Math.round(
    (list.slice(8, 16).reduce((s, it) => s + (it.pop || 0), 0) / Math.max(1, Math.min(8, Math.max(0, list.length - 8)))) * 100
  )
  return { temp, wind, rain: popToday, rainyTomorrow: popTomorrow >= 30 }
}

// حساب التوصية
function getAdvice({ crop, areaM2, emittersPerM2, emitterLph, temp, wind, rain, rainyTomorrow }) {
  // أساس حسب المحصول للمتر المربع (لتر/م²/يوم)
  const basePerM2 = { fraise: 2.5, framboise: 2.8, avocat: 4.0 }[crop] ?? 2.5
  let need = basePerM2

  if (temp >= 35) need *= 1.4
  else if (temp >= 30) need *= 1.2
  else if (temp <= 10) need *= 0.8

  if (wind >= 40) need *= 1.15
  if (rain >= 60) need *= 0.3
  else if (rain >= 30) need *= 0.6

  const liters = Math.max(0, Math.round(need * areaM2))
  const totalEmitterFlowLph = emittersPerM2 * areaM2 * emitterLph
  const minutes = totalEmitterFlowLph > 0 ? Math.round((liters / totalEmitterFlowLph) * 60) : 0

  const postpone =
    rainyTomorrow && rain < 20 && liters > 0 ? { title: "أجّل السقي اليوم", reason: "غداً متوقع المطر" } : null
  const decision =
    postpone ||
    (liters === 0
      ? { title: "ما تسقّيش اليوم", reason: "الاحتياج ضعيف بسبب المطر/الطقس" }
      : { title: "سقي عادي", reason: "ظروف متوسطة" })

  const tip =
    crop === "avocat"
      ? "سقي عميق وبعيد بين الدورات."
      : crop === "framboise"
      ? "حافظ على صرف جيد وتحكم فالتربة."
      : "سقي خفيف ومتكرر لتجنّب تعفن الجذور."

  return { liters, minutes, decision, tip }
}

export default function Irrigation() {
  // حالة النموذج
  const s0 = loadJSON(LS_FORM, {
    crop: "fraise",                // المحصول
    zoneName: "Zone A — 100 m²",   // اسم/وصف قطعة
    areaM2: 100,                   // المساحة
    emittersPerM2: 4,              // عدد النقاط/م²
    emitterLph: 2,                 // صبيب النقطة (ل/ساعة)
    placeQuery: "",                // إدخال المستخدم
    autoGPS: true,                 // تفعيل GPS تلقائي
    lastPlace: "",                 // المكان الأخير
  })
  const [crop, setCrop] = useState(s0.crop)
  const [zoneName, setZoneName] = useState(s0.zoneName)
  const [areaM2, setAreaM2] = useState(s0.areaM2)
  const [emittersPerM2, setEmittersPerM2] = useState(s0.emittersPerM2)
  const [emitterLph, setEmitterLph] = useState(s0.emitterLph)

  const [placeQuery, setPlaceQuery] = useState(s0.placeQuery)
  const [autoGPS, setAutoGPS] = useState(s0.autoGPS)
  const [resolvedPlace, setResolvedPlace] = useState(s0.lastPlace)

  const [temp, setTemp] = useState(20)
  const [rain, setRain] = useState(10)
  const [wind, setWind] = useState(5)
  const [rainyTomorrow, setRainyTomorrow] = useState(false)

  const [loadingWx, setLoadingWx] = useState(false)
  const [err, setErr] = useState("")
  const [open, setOpen] = useState({ quick: true, field: true, weather: true, summary: true, history: false })

  // حافظ كل تغيير
  useEffect(() => {
    saveJSON(LS_FORM, {
      crop,
      zoneName,
      areaM2,
      emittersPerM2,
      emitterLph,
      placeQuery,
      autoGPS,
      lastPlace: resolvedPlace,
    })
  }, [crop, zoneName, areaM2, emittersPerM2, emitterLph, placeQuery, autoGPS, resolvedPlace])

  // GPS تلقائي
  useEffect(() => {
    if (!autoGPS || !OWM_KEY) return
    setErr("")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          setLoadingWx(true)
          const { latitude: lat, longitude: lon } = pos.coords
          const f = await fetchForecast(lat, lon)
          const s = summarize(f)
          if (!s) throw new Error("no summary")
          setTemp(s.temp)
          setWind(s.wind)
          setRain(s.rain)
          setRainyTomorrow(s.rainyTomorrow)
          setResolvedPlace(f?.city?.name || "GPS")
        } catch (e) {
          setErr("تعذّر جلب الطقس عبر GPS")
        } finally {
          setLoadingWx(false)
        }
      },
      () => setErr("خاص ترخيص GPS من المتصفح")
    )
  }, [autoGPS])

  async function handleCityFetch() {
    if (!placeQuery.trim() || !OWM_KEY) return
    setErr("")
    try {
      setLoadingWx(true)
      const { lat, lon, label } = await geocodeCity(placeQuery.trim())
      const f = await fetchForecast(lat, lon)
      const s = summarize(f)
      if (!s) throw new Error("no summary")
      setTemp(s.temp)
      setWind(s.wind)
      setRain(s.rain)
      setRainyTomorrow(s.rainyTomorrow)
      setResolvedPlace(label)
    } catch (e) {
      setErr("ما قدرناش نجيبو الطقس لهاد المكان")
    } finally {
      setLoadingWx(false)
    }
  }

  const advice = useMemo(
    () =>
      getAdvice({
        crop,
        areaM2: +areaM2 || 0,
        emittersPerM2: +emittersPerM2 || 0,
        emitterLph: +emitterLph || 0,
        temp,
        wind,
        rain,
        rainyTomorrow,
      }),
    [crop, areaM2, emittersPerM2, emitterLph, temp, wind, rain, rainyTomorrow]
  )

  // مشاركة واتساب
  function shareWhatsApp() {
    const txt = `💧 توصية السقي
• المحصول: ${crop === "fraise" ? "فراولة" : crop === "framboise" ? "فرامبواز" : "أفوكا"}
• القطعة: ${zoneName}
• المكان: ${resolvedPlace || "غير محدد"}
• الطقس: حرارة ${temp}°C • ريح ${wind} كم/س • شتا ${rain}%
• الكمية: ${advice.liters} لتر (≈ ${advice.minutes} دقيقة)
(Agrimoga)`
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank")
  }

  // حفظ Snapshot للتاريخ
  function addHistoryNote() {
    const prev = loadJSON(LS_LAST, [])
    const row = {
      at: Date.now(),
      crop,
      zoneName,
      areaM2,
      liters: advice.liters,
      minutes: advice.minutes,
      place: resolvedPlace,
      weather: { temp, wind, rain, rainyTomorrow },
    }
    const next = [row, ...prev].slice(0, 50)
    saveJSON(LS_LAST, next)
    setOpen((s) => ({ ...s, history: true }))
  }

  const history = loadJSON(LS_LAST, [])

  return (
    <div className="page">
      {/* شريط معلومات سريع */}
      <section className="ribbon">
        <div className="chip">
          <Bell size={16} />
          <b>{advice.decision.title}</b>
          <span className="muted">— {advice.decision.reason}</span>
        </div>
        <div className="muted small">المكان: {resolvedPlace || "غير محدد"}</div>
      </section>

      {/* تخطيط عمودي احترافي */}
      <div className="stack">
        {/* Quick panel */}
        <Card title="السقي — توصية سريعة" open={open.quick} onToggle={() => setOpen((s) => ({ ...s, quick: !s.quick }))}>
          <div className="grid2">
            <div className="formrow">
              <label className="label">ابحث عن مكان</label>
              <div className="hstack">
                <input
                  className="input"
                  placeholder="Kenitra / Larache ..."
                  value={placeQuery}
                  onChange={(e) => setPlaceQuery(e.target.value)}
                />
                <button className="btn ghost" onClick={handleCityFetch} disabled={loadingWx || !OWM_KEY}>
                  <Cloud size={16} /> جيب الطقس
                </button>
              </div>
              <label className="switch">
                <input type="checkbox" checked={autoGPS} onChange={(e) => setAutoGPS(e.target.checked)} />
                <span>
                  <Locate size={14} /> تفعيل GPS تلقائياً
                </span>
              </label>
              {err && <p className="err">⚠️ {err}</p>}
              {loadingWx && <p className="muted small">… كنجلبو الطقس</p>}
            </div>

            <div className="sliders">
              <Range label={<><Thermometer size={14}/> حرارة</>} value={temp} set={setTemp} min={-5} max={45}/>
              <Range label={<><Droplets size={14}/> رطوبة/مطر</>} value={rain} set={setRain} min={0} max={100} step={5}/>
              <Range label={<><Wind size={14}/> الريح</>} value={wind} set={setWind} min={0} max={90} step={5}/>
              <label className="switch" style={{marginTop:6}}>
                <input type="checkbox" checked={rainyTomorrow} onChange={e=>setRainyTomorrow(e.target.checked)} />
                <span>مطر متوقع غداً؟ {rainyTomorrow ? "نعم" : "لا"}</span>
              </label>
            </div>
          </div>
        </Card>

        {/* Field panel */}
        <Card title="المحصول والقطعة" open={open.field} onToggle={() => setOpen((s) => ({ ...s, field: !s.field }))}>
          <div className="grid2">
            <div className="formrow">
              <label className="label">المحصول</label>
              <select className="input" value={crop} onChange={(e) => setCrop(e.target.value)}>
                <option value="fraise">🍓 فراولة</option>
                <option value="framboise">🫐 فرامبواز</option>
                <option value="avocat">🥑 أفوكا</option>
              </select>
            </div>
            <div className="formrow">
              <label className="label">القطعة</label>
              <input className="input" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            </div>
            <div className="formrow">
              <label className="label">المساحة (م²)</label>
              <input
                type="number"
                className="input"
                value={areaM2}
                onChange={(e) => setAreaM2(Math.max(0, +e.target.value || 0))}
              />
            </div>
            <div className="formrow">
              <label className="label">النقاط/م²</label>
              <input
                type="number"
                className="input"
                value={emittersPerM2}
                onChange={(e) => setEmittersPerM2(Math.max(0, +e.target.value || 0))}
              />
            </div>
            <div className="formrow">
              <label className="label">صبيب النقطة (ل/ساعة)</label>
              <input
                type="number"
                className="input"
                value={emitterLph}
                onChange={(e) => setEmitterLph(Math.max(0, +e.target.value || 0))}
              />
            </div>
            <div className="pill muted">
              الصبيب الإجمالي:{" "}
              <b>
                {Math.round((emittersPerM2 || 0) * (areaM2 || 0) * (emitterLph || 0))} ل/ساعة
              </b>
            </div>
          </div>
        </Card>

        {/* Summary panel */}
        <Card title="التوصية" open={open.summary} onToggle={() => setOpen((s) => ({ ...s, summary: !s.summary }))}>
          <div className="grid3">
            <div className="pill">
              <p className="muted">الكمية المقترحة</p>
              <p className="big">{advice.liters} L</p>
              <p className="muted">للمساحة: {areaM2} م²</p>
            </div>
            <div className="pill">
              <p className="muted">مدة التشغيل التقديرية</p>
              <p className="big">~ {advice.minutes} د</p>
              <p className="muted">حسب الصبيب الإجمالي</p>
            </div>
            <div className="pill">
              <p className="muted">نصيحة</p>
              <p>{advice.tip}</p>
            </div>
          </div>

          <div className="hstack">
            <button className="btn primary" onClick={addHistoryNote}>
              سجّل العملية
            </button>
            <button className="btn" onClick={shareWhatsApp}>
              <Share2 size={16} /> مشاركة عبر WhatsApp
            </button>
          </div>
        </Card>

        {/* History */}
        <Card title="سِجل السقي" open={open.history} onToggle={() => setOpen((s) => ({ ...s, history: !s.history }))}>
          {history.length === 0 ? (
            <p className="muted">لا توجد مدخلات.</p>
          ) : (
            <div className="table">
              <div className="thead">
                <div>التاريخ</div>
                <div>القطعة</div>
                <div>المكان</div>
                <div>الكمية</div>
                <div>المدة</div>
              </div>
              {history.map((h, i) => (
                <div className="trow" key={i}>
                  <div>{new Date(h.at).toLocaleString("ar-MA")}</div>
                  <div>{h.zoneName}</div>
                  <div>{h.place}</div>
                  <div>{h.liters} L</div>
                  <div>{h.minutes} د</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// مكوّنات صغيرة للواجهة
function Card({ title, open, onToggle, children }) {
  return (
    <section className={`card pro ${open ? "open" : ""}`}>
      <button className="card-head" onClick={onToggle} type="button">
        <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <h3>{title}</h3>
      </button>
      {open && <div className="card-body">{children}</div>}
    </section>
  )
}
function Range({ label, value, set, min, max, step = 1 }) {
  return (
    <div className="range">
      <label className="label">{label}: <b>{value}</b></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e)=>set(+e.target.value)} />
    </div>
  )
}
