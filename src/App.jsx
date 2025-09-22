import { useEffect, useState } from 'react'
import Irrigation from '@/sections/Irrigation'
import Diseases from '@/sections/Diseases'
import Fertilization from '@/sections/Fertilization'
import Harvest from '@/sections/Harvest'
import Prices from '@/sections/Prices'
import LangSwitcher from '@/components/LangSwitcher'
import { I18nProvider, useI18n } from '@/i18n/context'
import { Leaf, FlaskConical, Stethoscope, ShoppingBasket, CalendarRange, Droplets } from 'lucide-react'
import { loadJSON } from '@/Lib/storage'

const LS_RISK = 'agrimoga:diseaseRisk'

function AppInner() {
  const [tab, setTab] = useState('water') // water | disease | fert | harvest | prices
  const [risk, setRisk] = useState(loadJSON(LS_RISK, {score:0, level:'منخفض'}))
  const { t } = useI18n()

  useEffect(()=>{
    const tmr = setInterval(()=> setRisk(loadJSON(LS_RISK, {score:0, level:'منخفض'})), 1500)
    return ()=> clearInterval(tmr)
  }, [])

  const Badge = () => <span className="badge-dot" title={`${t('diseases.riskLevel')}: ${risk.level}`}/>

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Leaf className="w-7 h-7" />
            <h1 className="text-2xl md:text-3xl font-bold">{t('app.title')}</h1>
          </div>
          <LangSwitcher/>
        </div>

        {/* التبويبات */}
        <div className="flex gap-2">
          <button className={`tab ${tab==='water'?'tab--active':''}`} onClick={()=>setTab('water')}>
            <Droplets size={16}/> {t('tab.water')}
          </button>
          <button className={`tab ${tab==='disease'?'tab--active':''}`} onClick={()=>setTab('disease')}>
            <Stethoscope size={16}/> {t('tab.disease')}
            {risk?.score >= 2 && <Badge/>}
          </button>
          <button className={`tab ${tab==='fert'?'tab--active':''}`} onClick={()=>setTab('fert')}>
            <FlaskConical size={16}/> {t('tab.fert')}
          </button>
          <button className={`tab ${tab==='harvest'?'tab--active':''}`} onClick={()=>setTab('harvest')}>
            <CalendarRange size={16}/> {t('tab.harvest')}
          </button>
          <button className={`tab ${tab==='prices'?'tab--active':''}`} onClick={()=>setTab('prices')}>
            <ShoppingBasket size={16}/> {t('tab.prices')}
          </button>
        </div>

        {/* المحتوى */}
        {tab==='water'   && <Irrigation/>}
        {tab==='disease' && <Diseases/>}
        {tab==='fert'    && <Fertilization/>}
        {tab==='harvest' && <Harvest/>}
        {tab==='prices'  && <Prices/>}

        <p className="text-xs text-center text-muted-foreground">Agrimoga — MVP</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AppInner/>
    </I18nProvider>
  )
}
