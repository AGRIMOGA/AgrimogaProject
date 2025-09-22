import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Thermometer, Wind, Droplets, Bell, Calendar, Locate, WifiOff, Share2, MapPin, RotateCw, Plus, Trash2, Download
} from 'lucide-react'
import { loadJSON, saveJSON } from '@/Lib/storage'
import { useI18n } from '@/i18n/context'

/** ====== OpenWeather ====== **/
const OWM_API_KEY = import.meta.env.VITE_OWM_API_KEY

async function fetchForecast(lat, lon, lang) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&lang=${lang}&appid=${OWM_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('forecast_failed')
  return await res.json()
}

/** Reverse geocoding: OWM then OSM (fallback) */
async function reverseOWM(lat, lon) {
  const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=5&appid=${OWM_API_KEY}`
  const r = await fetch(url)
  if (!r.ok) throw new Error('owm_rev_failed')
  const arr = await r.json()
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('owm_rev_empty')
  for (const it of arr) {
    const cand = it.local_names?.ar || it.local_names?.fr || it.local_names?.en || it.name
    if (cand) return cand
  }
  return arr[0].name
}
async function reverseOSM(lat, lon, lang) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=${lang}&zoom=12`
  const r = await fetch(url, { headers: { 'User-Agent': 'agrimoga-mvp/1.0' } })
  if (!r.ok) throw new Error('osm_rev_failed')
  const j = await r.json()
  const a = j.address || {}
  const best = a.city || a.town || a.municipality || a.village || a.county || a.state || j.name || j.display_name
  if (!best) throw new Error('osm_rev_empty')
  return best
}
async function resolvePlaceName(lat, lon, lang) {
  try { const n = await reverseOWM(lat, lon); if (n) return n } catch {}
  try { const n2 = await reverseOSM(lat, lon, lang); return n2 } catch {}
  return ''
}

/** Summarize 5-day/3h forecast into today's snapshot + rain tomorrow */
function summarizeWeather(forecast) {
  const list = forecast?.list || []
  if (list.length === 0) return null
  const now = list[0]
  const temp = Math.round(now.main.temp)
  const wind = Math.round(now.wind.speed * 3.6) // m/s -> km/h
  const popToday = Math.round(
    (list.slice(0, 8).reduce((s, it) => s + (it.pop || 0), 0) / Math.min(8, list.length)) * 100
  )
  const popTomorrow = Math.round(
    (list.slice(8, 16).reduce((s, it) => s + (it.pop || 0), 0) /
      Math.max(1, Math.min(8, Math.max(0, list.length - 8)))) * 100
  )
  const rainyTomorrow = popTomorrow >= 30
  return { temp, wind, rain: popToday, rainyTomorrow }
}

/** Water advice (L) per 100m² baseline, adjusted by conditions */
function getIrrigation({ crop, temp, rain, wind, rainyTomorrow, areaSize, lang, t }) {
  const base = { fraise: 250, avocat: 400, framboise: 280 }[crop] // L / 100 m²
  let liters = base
  if (temp >= 35) liters *= 1.4
  else if (temp >= 30) liters *= 1.2
  else if (temp <= 10) liters *= 0.8
  if (wind >= 40) liters *= 1.2
  if (rain >= 60) liters *= 0.25
  else if (rain >= 30) liters *= 0.6
  const postpone = rainyTomorrow && rain < 20
  const litersForArea = Math.round((liters / 100) * areaSize)

  const decision = postpone
    ? { title: t('irr.tip.delay'), kind: 'postpone' }
    : litersForArea < 80
    ? { title: lang === 'fr' ? 'Arrosage léger' : lang === 'en' ? 'Light irrigation' : 'سقي خفيف', kind: 'light' }
    : litersForArea > 500
    ? { title: lang === 'fr' ? 'Arrosage important' : lang === 'en' ? 'Heavy irrigation' : 'سقي مهم', kind: 'heavy' }
    : { title: lang === 'fr' ? 'Arrosage normal' : lang === 'en' ? 'Normal irrigation' : 'سقي عادي', kind: 'normal' }

  const cropTip =
    crop === 'fraise'
      ? (lang==='fr' ? 'Arroser par petites impulsions rapprochées.' :
         lang==='en' ? 'Irrigate in short, frequent pulses.' :
                       'سقي خفيف ومتكرر.')
      : crop === 'avocat'
      ? (lang==='fr' ? 'Arrosage profond et espacé.' :
         lang==='en' ? 'Deep, infrequent irrigation.' :
                       'سقي عميق وبعيد بين الدورات.')
      : (lang==='fr' ? 'Équilibrer l’eau et assurer un bon drainage.' :
         lang==='en' ? 'Balance water and ensure good drainage.' :
                       'حافظ على توازن الماء وصرف جيد.')

  return { liters: Math.max(litersForArea, 0), decision, tip: cropTip }
}

/** Flow & runtime helpers */
function calcFlowLph({ pumpFlowM3h, emittersPerM2, emitterFlowLph, areaSize }) {
  if (pumpFlowM3h && pumpFlowM3h > 0) return pumpFlowM3h * 1000 // m3/h -> L/h
  return Math.max(0, (emittersPerM2 || 0) * (emitterFlowLph || 0) * areaSize)
}
function calcRuntimeMin(liters, flowLph) {
  return flowLph > 0 ? Math.max(1, Math.round((liters / flowLph) * 60)) : 0
}

/** Storage keys */
const LS_LAST = 'agrimoga:lastAdvice'
const LS_FORM = 'agrimoga:waterForm'
const LS_LOGS = 'agrimoga:irrigLogs'

export default function Irrigation() {
  const { t, lang } = useI18n()

  // --- form state (with zones & network) ---
  const s0 = loadJSON(LS_FORM, {
    crop: 'fraise',
    areaSize: 100,
    zones: [{ id: 'A', name: 'Zone A', area: 100 }],
    zoneId: 'A',
    pumpFlowM3h: 0,
    emittersPerM2: 4,
    emitterFlowLph: 2,
  })
  const [crop, setCrop] = useState(s0.crop)
  const [zones, setZones] = useState(s0.zones)
  const [zoneId, setZoneId] = useState(s0.zoneId)
  const areaSize = useMemo(() => (zones.find(z => z.id === zoneId)?.area) ?? 100, [zones, zoneId])

  const [pumpFlowM3h, setPumpFlowM3h] = useState(s0.pumpFlowM3h)
  const [emittersPerM2, setEmittersPerM2] = useState(s0.emittersPerM2)
  const [emitterFlowLph, setEmitterFlowLph] = useState(s0.emitterFlowLph)

  // --- weather & gps ---
  const [temp, setTemp] = useState(28)
  const [rain, setRain] = useState(10)
  const [wind, setWind] = useState(15)
  const [rainyTomorrow, setRainyTomorrow] = useState(false)
  const [place, setPlace] = useState('')
  const [accuracy, setAccuracy] = useState(null) // m

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const [showAdvice, setShowAdvice] = useState(false)
  const triedAuto = useRef(false)

  // logs
  const [logs, setLogs] = useState(loadJSON(LS_LOGS, []))

  // advice
  const advice = useMemo(
    () => getIrrigation({ crop, temp, rain, wind, rainyTomorrow, areaSize, lang, t }),
    [crop, temp, rain, wind, rainyTomorrow, areaSize, lang, t]
  )
  const flowLph = useMemo(() => calcFlowLph({ pumpFlowM3h, emittersPerM2, emitterFlowLph, areaSize }), [pumpFlowM3h, emittersPerM2, emitterFlowLph, areaSize])
  const minutes = useMemo(() => calcRuntimeMin(advice.liters, flowLph), [advice.liters, flowLph])

  // persist form
  useEffect(() => {
    saveJSON(LS_FORM, { crop, zones, zoneId, pumpFlowM3h, emittersPerM2, emitterFlowLph })
  }, [crop, zones, zoneId, pumpFlowM3h, emittersPerM2, emitterFlowLph])

  // online/offline
  useEffect(() => {
    const on = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // load last snapshot
  useEffect(() => {
    const s = loadJSON(LS_LAST, null)
    if (s) {
      setCrop(s.crop); setTemp(s.temp); setRain(s.rain); setWind(s.wind)
      setRainyTomorrow(!!s.rainyTomorrow); setPlace(s.place || ''); setAccuracy(s.accuracy ?? null)
      setShowAdvice(true)
    }
  }, [])

  // auto GPS once
  useEffect(() => {
    if (triedAuto.current) return
    triedAuto.current = true
    locateWithGPS()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // persist snapshot
  useEffect(() => {
    if (!showAdvice) return
    saveJSON(LS_LAST, { crop, temp, rain, wind, rainyTomorrow, areaSize, place, accuracy, savedAt: Date.now() })
  }, [showAdvice, crop, temp, rain, wind, rainyTomorrow, areaSize, place, accuracy])

  /** ===== actions ===== */
  async function locateWithGPS() {
    setError('')
    setLoading(true)
    if (!navigator.geolocation) {
      setError(lang==='fr' ? 'GPS non supporté' : lang==='en' ? 'GPS not supported' : 'GPS غير مدعوم')
      setLoading(false); return
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords
          setAccuracy(Math.round(acc || 0))
          const fc = await fetchForecast(lat, lon, lang)
          const s = summarizeWeather(fc)
          if (!s) throw new Error('summ_empty')
          setTemp(s.temp); setRain(s.rain); setWind(s.wind); setRainyTomorrow(s.rainyTomorrow)
          const name = await resolvePlaceName(lat, lon, lang)
          setPlace(name || (lang==='fr' ? 'Localisation approximative' : lang==='en' ? 'Approximate location' : 'موقع تقريبي'))
          setShowAdvice(true)
        } catch (e) {
          setError(lang==='fr' ? 'Erreur localisation/météo' : lang==='en' ? 'Location/Weather error' : 'مشكلة في تحديد الموقع/الطقس')
        } finally { setLoading(false) }
      },
      () => { setError(lang==='fr' ? 'Autorisez la localisation' : lang==='en' ? 'Allow location access' : 'خاص ترخيص GPS من المتصفح'); setLoading(false) },
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 12_000 }
    )
  }

  function shareWhatsApp() {
    const cropName =
      crop === 'fraise' ? (lang==='fr' ? 'Fraise' : lang==='en' ? 'Strawberry' : 'فراولة')
      : crop === 'avocat' ? (lang==='fr' ? 'Avocat' : lang==='en' ? 'Avocado' : 'أفوكادو')
      : (lang==='fr' ? 'Framboise' : lang==='en' ? 'Raspberry' : 'فرامبواز')
    const txt =
`${lang==='fr' ? 'Recommandation irrigation' : lang==='en' ? 'Irrigation advice' : 'التوصية ديال السقي'}
• ${t('irr.crop')}: ${cropName}
• ${lang==='fr' ? 'Lieu' : lang==='en' ? 'Place' : 'المكان'}: ${place || (lang==='fr' ? 'Non spécifié' : lang==='en' ? 'Not set' : 'غير محدد')}
• ${lang==='fr' ? 'Aujourd’hui' : lang==='en' ? 'Today' : 'اليوم'}: ${temp}°C • ${lang==='fr' ? 'Vent' : lang==='en' ? 'Wind' : 'ريح'} ${wind} km/h • ${lang==='fr' ? 'Pluie' : lang==='en' ? 'Rain' : 'شتا'} ${rain}%
• ${lang==='fr' ? 'Quantité' : lang==='en' ? 'Amount' : 'الكمية'}: ${advice.liters} L / ${areaSize} m²
• ${lang==='fr' ? 'Durée' : lang==='en' ? 'Duration' : 'المدّة'}: ~${minutes} ${lang==='fr' ? 'min' : lang==='en' ? 'min' : 'د'}
• ${lang==='fr' ? 'Note' : lang==='en' ? 'Note' : 'الملاحظة'}: ${advice.decision.title}
(Agrimoga)`
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank')
  }

  function addZone() {
    const name = prompt(lang==='fr' ? 'Nom de la zone ?' : lang==='en' ? 'Zone name?' : 'إسم الزون؟')
    if (!name) return
    const a = Number(prompt(lang==='fr' ? 'Superficie (m²) ?' : lang==='en' ? 'Area (m²)?' : 'المساحة (م²)؟') || 0)
    if (!(a > 0)) return
    const id = `${Date.now()}`
    const next = [...zones, { id, name, area: a }]
    setZones(next); setZoneId(id)
  }
  function removeZone() {
    if (!zoneId) return
    const next = zones.filter(z => z.id !== zoneId)
    setZones(next)
    if (next.length) setZoneId(next[0].id)
  }

  function logCurrent() {
    const z = zones.find(z => z.id === zoneId)
    const item = {
      ts: Date.now(),
      crop, place,
      zone: z?.name || '',
      area: areaSize,
      liters: advice.liters,
      minutes,
    }
    const next = [item, ...logs].slice(0, 100)
    setLogs(next)
    saveJSON(LS_LOGS, next)
    alert(lang==='fr' ? 'Enregistré.' : lang==='en' ? 'Saved.' : 'تسجّل.')
  }
  function clearLogs() {
    if (!confirm(lang==='fr' ? 'Effacer le journal ?' : lang==='en' ? 'Clear logs?' : 'تمسح السجل؟')) return
    setLogs([]); saveJSON(LS_LOGS, [])
  }
  function exportCSV() {
    const rows = [
      ['date','crop','place','zone','area_m2','liters','minutes'],
      ...logs.map(x => [
        new Date(x.ts).toISOString(),
        x.crop, x.place, x.zone, x.area, x.liters, x.minutes
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'irrigation_logs.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      {offline && (
        <div className="alert" style={{ maxWidth: 600 }}>
          <WifiOff size={14} style={{ verticalAlign: '-2px' }} />{' '}
          {lang==='fr' ? 'Hors ligne. Dernière recommandation affichée.' :
           lang==='en' ? 'Offline. Showing last saved advice.' :
                         'راك أوفلاين. نعرضو آخر توصية محفوظة.'}
        </div>
      )}

      <div className="grid2 section">
        {/* الطقس */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('irr.title')}</h3>

          <div className="pill" style={{ marginBottom: 10, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <MapPin size={14} /> {place || (lang==='fr' ? 'En attente de localisation…' : lang==='en' ? 'Waiting for location…' : 'كنتسناو تحديد الموقع…')}
            {accuracy!=null && (
              <span className="muted">
                {lang==='fr' ? 'Précision' : lang==='en' ? 'Accuracy' : 'الدقّة'} ±{accuracy}m {accuracy>1000 ? (lang==='fr' ? '(approx.)' : lang==='en' ? '(approx.)' : '(تقريباً)') : ''}
              </span>
            )}
            <button className="input" onClick={locateWithGPS} disabled={loading} style={{ cursor:'pointer', marginInlineStart:'auto' }}>
              <RotateCw size={14}/> {lang==='fr' ? 'Mettre à jour' : lang==='en' ? 'Refresh' : 'تحديث'}
            </button>
          </div>

          <div className="grid3">
            <div>
              <label className="label"><Thermometer size={14}/> {t('diseases.temp')}: {temp}°C</label>
              <input type="range" min={-5} max={45} step={1} value={temp} onChange={e=>setTemp(+e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label className="label"><Droplets size={14}/> {t('diseases.rain')}: {rain}%</label>
              <input type="range" min={0} max={100} step={5} value={rain} onChange={e=>setRain(+e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label className="label"><Wind size={14}/> {lang==='fr' ? 'Vent' : lang==='en' ? 'Wind' : 'الريح'}: {wind} km/h</label>
              <input type="range" min={0} max={90} step={5} value={wind} onChange={e=>setWind(+e.target.value)} style={{ width: '100%' }} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input type="checkbox" checked={rainyTomorrow} onChange={(e)=>setRainyTomorrow(e.target.checked)} />
            <span className="label" style={{ marginTop: 0 }}>
              <Calendar size={14} /> {lang==='fr' ? 'Pluie demain ?' : lang==='en' ? 'Rain tomorrow?' : 'مطر متوقع غداً؟'} {rainyTomorrow ? (lang==='fr' ? 'Oui' : lang==='en' ? 'Yes' : 'نعم') : (lang==='fr' ? 'Non' : lang==='en' ? 'No' : 'لا')}
            </span>
          </div>

          <button className="btn" onClick={()=>setShowAdvice(true)} style={{ marginTop: 10 }}>
            <Bell size={16} /> {lang==='fr' ? 'Donner la recommandation' : lang==='en' ? 'Give recommendation' : 'عطيني التوصية'}
          </button>
        </div>

        {/* إعدادات الحقل + الزونات + الشبكة */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('irr.crop')}</h3>
          <select value={crop} onChange={e=>setCrop(e.target.value)} className="input">
            <option value="fraise">🍓 {t('crop.fraise')}</option>
            <option value="avocat">🥑 {t('crop.avocat')}</option>
            <option value="framboise">🫐 {t('crop.framboise')}</option>
          </select>

          <div className="section">
            <label className="label">{lang==='fr' ? 'Zone' : lang==='en' ? 'Zone' : 'الزون'}</label>
            <div style={{display:'flex', gap:8}}>
              <select className="input" value={zoneId} onChange={e=>setZoneId(e.target.value)}>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name} — {z.area} m²</option>)}
              </select>
              <button className="input" onClick={addZone} style={{cursor:'pointer'}}><Plus size={14}/> {lang==='fr' ? 'Ajouter' : lang==='en' ? 'Add' : 'إضافة'}</button>
              <button className="input" onClick={removeZone} style={{cursor:'pointer'}}><Trash2 size={14}/> {lang==='fr' ? 'Supprimer' : lang==='en' ? 'Remove' : 'حذف'}</button>
            </div>
          </div>

          <div className="section">
            <label className="label">{lang==='fr' ? 'Réseau' : lang==='en' ? 'Network' : 'شبكة الري'}</label>
            <div className="grid3">
              <div>
                <label className="label">{lang==='fr' ? 'Débit pompe (m³/h)' : lang==='en' ? 'Pump flow (m³/h)' : 'صبيب المضخة (م³/س)'}</label>
                <input type="number" min={0} step={0.1} className="input" value={pumpFlowM3h} onChange={e=>setPumpFlowM3h(+e.target.value||0)} />
                <p className="muted" style={{margin:0}}>
                  {lang==='fr' ? 'Si rempli, ignore les champs ci-dessous.' :
                   lang==='en' ? 'If set, fields below are ignored.' :
                                 'إذا عمرت هاد الحقل، كنهمل الحقول لتحت.'}
                </p>
              </div>
              <div>
                <label className="label">{lang==='fr' ? 'Émetteurs/m²' : lang==='en' ? 'Emitters/m²' : 'نقّاطات/م²'}</label>
                <input type="number" min={0} step={0.1} className="input" value={emittersPerM2} onChange={e=>setEmittersPerM2(+e.target.value||0)} />
              </div>
              <div>
                <label className="label">{lang==='fr' ? 'Débit émetteur (L/h)' : lang==='en' ? 'Emitter flow (L/h)' : 'صبيب النقّاطة (ل/س)'}</label>
                <input type="number" min={0} step={0.1} className="input" value={emitterFlowLph} onChange={e=>setEmitterFlowLph(+e.target.value||0)} />
              </div>
            </div>
          </div>

          <div className="pill" style={{marginTop:10}}>
            <p className="muted" style={{margin:0}}>
              {lang==='fr' ? 'Débit total estimé' : lang==='en' ? 'Estimated total flow' : 'الصبيب الإجمالي التقديري'}: <b>{flowLph.toLocaleString()} L/h</b>
            </p>
          </div>
        </div>
      </div>

      {/* التوصية + مدة التشغيل + مشاركة + لوج */}
      {showAdvice && (
        <div className="card section">
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bell size={18} /> {advice.decision.title}
          </h3>

          <div className="grid3">
            <div className="pill">
              <p className="muted">{lang==='fr' ? 'Quantité suggérée' : lang==='en' ? 'Suggested amount' : 'الكمية المقترحة'}</p>
              <p style={{ fontSize: 28, fontWeight: 700 }}>{advice.liters} L</p>
              <p className="muted">{lang==='fr' ? 'pour' : lang==='en' ? 'for' : 'لـ'} {areaSize} m²</p>
            </div>
            <div className="pill">
              <p className="muted">{lang==='fr' ? 'Durée de fonctionnement' : lang==='en' ? 'Runtime' : 'مدّة التشغيل'}</p>
              <p style={{ fontSize: 28, fontWeight: 700 }}>
                ~{minutes} {lang==='fr' ? 'min' : lang==='en' ? 'min' : 'د'}
              </p>
              <p className="muted">{lang==='fr' ? 'Débit' : lang==='en' ? 'Flow' : 'الصبيب'}: {flowLph.toLocaleString()} L/h</p>
            </div>
            <div className="pill">
              <p className="muted">{lang==='fr' ? 'Données du jour' : lang==='en' ? 'Today data' : 'معطيات اليوم'}</p>
              <p>{lang==='fr' ? 'Temp.' : lang==='en' ? 'Temp' : 'حرارة'}: {temp}°C • {lang==='fr' ? 'Pluie' : lang==='en' ? 'Rain' : 'شتا'}: {rain}% • {lang==='fr' ? 'Vent' : lang==='en' ? 'Wind' : 'ريح'}: {wind} km/h</p>
              <p className="muted">📍 {place || (lang==='fr' ? 'Non spécifié' : lang==='en' ? 'Not set' : 'غير محدد')}</p>
            </div>
          </div>

          <div className="pill" style={{ marginTop: 10, background: '#ecfdf5', borderColor: '#bbf7d0' }}>
            <p>💡 {lang==='fr' ? 'Astuce' : lang==='en' ? 'Tip' : 'نصيحة'}: {advice.tip}</p>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap:'wrap' }}>
            <button className="btn" onClick={shareWhatsApp} style={{ maxWidth: 280 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Share2 size={16} /> 📤 {lang==='fr' ? 'Partager WhatsApp' : lang==='en' ? 'Share on WhatsApp' : 'شارك عبر واتساب'}
              </span>
            </button>
            <button className="input" onClick={logCurrent} style={{cursor:'pointer'}}>
              <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                📝 {lang==='fr' ? 'Enregistrer cette opération' : lang==='en' ? 'Log this irrigation' : 'سجّل العملية'}
              </span>
            </button>
          </div>

          {/* سجل السقي */}
          <div className="section">
            <h4 style={{margin:'8px 0'}}>{lang==='fr' ? 'Journal des arrosages' : lang==='en' ? 'Irrigation log' : 'سجلّ السقي'}</h4>
            {logs.length === 0 ? (
              <p className="muted">{lang==='fr' ? 'Aucune entrée.' : lang==='en' ? 'No entries.' : 'لا توجد مدخلات.'}</p>
            ) : (
              <div style={{overflowX:'auto'}}>
                <table className="input" style={{width:'100%', borderCollapse:'collapse'}}>
                  <thead>
                    <tr>
                      <th style={{textAlign:'start'}}>⏱</th>
                      <th style={{textAlign:'start'}}>{lang==='fr' ? 'Zone' : lang==='en' ? 'Zone' : 'زون'}</th>
                      <th style={{textAlign:'start'}}>{lang==='fr' ? 'Surface' : lang==='en' ? 'Area' : 'مساحة'}</th>
                      <th style={{textAlign:'start'}}>{lang==='fr' ? 'Litres' : lang==='en' ? 'Liters' : 'لترات'}</th>
                      <th style={{textAlign:'start'}}>{lang==='fr' ? 'Durée' : lang==='en' ? 'Duration' : 'مدة'}</th>
                      <th style={{textAlign:'start'}}>{lang==='fr' ? 'Lieu' : lang==='en' ? 'Place' : 'مكان'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.slice(0,5).map((x,i)=>(
                      <tr key={i}>
                        <td>{new Date(x.ts).toLocaleString()}</td>
                        <td>{x.zone || '-'}</td>
                        <td>{x.area} m²</td>
                        <td>{x.liters} L</td>
                        <td>~{x.minutes} {lang==='fr' ? 'min' : lang==='en' ? 'min' : 'د'}</td>
                        <td>{x.place || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{display:'flex', gap:8, marginTop:8}}>
              <button className="input" onClick={exportCSV} style={{cursor:'pointer'}}><Download size={14}/> CSV</button>
              <button className="input" onClick={clearLogs} style={{cursor:'pointer'}}><Trash2 size={14}/> {lang==='fr' ? 'Vider' : lang==='en' ? 'Clear' : 'مسح'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
