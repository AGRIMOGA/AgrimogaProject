import React, { useState, useEffect } from "react";
import { loadJSON, saveJSON } from "../lib/storage";

export default function Irrigation() {
  const s0 = loadJSON("agrimoga:waterForm", {
    crop: "fraise",
    area: 100,
    location: "Kenitra",
    temp: 28,
    rain: 10,
    wind: 15,
    rainTomorrow: false,
  });

  const [crop, setCrop] = useState(s0.crop);
  const [area, setArea] = useState(s0.area);
  const [location, setLocation] = useState(s0.location);
  const [temp, setTemp] = useState(s0.temp);
  const [rain, setRain] = useState(s0.rain);
  const [wind, setWind] = useState(s0.wind);
  const [rainTomorrow, setRainTomorrow] = useState(s0.rainTomorrow);
  const [advice, setAdvice] = useState("");

  // حساب التوصية
  useEffect(() => {
    let base = 2.5; // لتر لكل م²
    if (temp > 30) base += 0.5;
    if (rain > 50 || rainTomorrow) base -= 1;

    const liters = Math.max(0, Math.round(base * area));
    const msg = `💧 التوصية: سقي ${liters} لتر للمساحة ${area} م² — محصول: ${crop} @ ${location}`;
    setAdvice(msg);

    saveJSON("agrimoga:waterForm", {
      crop,
      area,
      location,
      temp,
      rain,
      wind,
      rainTomorrow,
    });
    saveJSON("agrimoga:lastAdvice", msg);
  }, [crop, area, location, temp, rain, wind, rainTomorrow]);

  // 🔗 مشاركة عبر واتساب
  const shareWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(advice)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">💧 السقي</h2>

      <div className="grid grid-cols-2 gap-2">
        <label>
          المحصول:
          <select
            value={crop}
            onChange={(e) => setCrop(e.target.value)}
            className="border rounded p-1 w-full"
          >
            <option value="fraise">🍓 فراولة</option>
            <option value="avocat">🥑 أفوكادو</option>
            <option value="framboise">🍇 فرامبواز</option>
          </select>
        </label>

        <label>
          المساحة (م²):
          <input
            type="number"
            value={area}
            onChange={(e) => setArea(Number(e.target.value))}
            className="border rounded p-1 w-full"
          />
        </label>
      </div>

      <div>
        <p>🌡 الحرارة: {temp}°C</p>
        <p>🌧 احتمال الشتا: {rain}%</p>
        <p>💨 الريح: {wind} كم/س</p>
        <label>
          <input
            type="checkbox"
            checked={rainTomorrow}
            onChange={(e) => setRainTomorrow(e.target.checked)}
          />
          مطر متوقع غداً؟
        </label>
      </div>

      <div className="p-3 border rounded bg-green-50">
        <p className="font-semibold">✅ التوصية:</p>
        <p>{advice}</p>
      </div>

      {/* زر المشاركة */}
      <div className="flex gap-2">
        <button
          onClick={shareWhatsApp}
          className="bg-green-600 text-white px-3 py-2 rounded shadow hover:bg-green-700"
        >
          📤 شارك عبر WhatsApp
        </button>
      </div>
    </div>
  );
}
