import { useEffect, useMemo, useState } from "react";
import { loadJSON, saveJSON } from "@/Lib/storage";
import { useI18n } from "@/i18n/context";

const LS_KEY = "agrimoga:harvest";

function toNumber(x, def = 0) {
  const n = +x;
  return Number.isFinite(n) ? n : def;
}
function ensureArray(x) {
  return Array.isArray(x) ? x : [];
}
function normalizeLog(r) {
  return {
    date: r?.date || new Date().toISOString().slice(0, 10),
    crop: r?.crop || "fraise",
    quality: r?.quality || "A",
    qtyKg: toNumber(r?.qtyKg, 0),
    price: toNumber(r?.price, 0),
    total: toNumber(r?.total, 0),
  };
}

export default function Harvest() {
  const { t, lang } = useI18n();

  // حمّل الحالة من LS مع تنظيف صارم
  const s0raw = loadJSON(LS_KEY, {
    crop: "fraise",
    date: new Date().toISOString().slice(0, 10),
    quality: "A",
    qtyKg: 50,
    price: 12,
    logs: [],
  });

  const [crop, setCrop] = useState(s0raw?.crop || "fraise");
  const [date, setDate] = useState(s0raw?.date || new Date().toISOString().slice(0, 10));
  const [quality, setQuality] = useState(s0raw?.quality || "A");
  const [qtyKg, setQtyKg] = useState(toNumber(s0raw?.qtyKg, 0));
  const [price, setPrice] = useState(toNumber(s0raw?.price, 0));
  const [logs, setLogs] = useState(ensureArray(s0raw?.logs).map(normalizeLog));

  // خزّن بأمان
  useEffect(() => {
    saveJSON(LS_KEY, { crop, date, quality, qtyKg, price, logs });
  }, [crop, date, quality, qtyKg, price, logs]);

  // إضافة سطر
  const addLog = () => {
    const q = Math.max(0, toNumber(qtyKg, 0));
    const p = Math.max(0, toNumber(price, 0));
    const total = q * p;

    const row = normalizeLog({ date, crop, quality, qtyKg: q, price: p, total });
    setLogs((old) => [row, ...ensureArray(old)]);
  };

  // مجاميع
  const totals = useMemo(() => {
    const safe = ensureArray(logs).map(normalizeLog);
    const sumKg = safe.reduce((a, r) => a + toNumber(r.qtyKg, 0), 0);
    const sumMAD = safe.reduce((a, r) => a + toNumber(r.total, 0), 0);
    return { sumKg, sumMAD };
  }, [logs]);

  // فورمات أرقام
  const nf = (n) =>
    (Number.isFinite(+n) ? +n : 0).toLocaleString(
      lang === "fr" ? "fr-FR" : lang === "en" ? "en-US" : "ar-MA"
    );

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t("harv.title")}</h3>

      <div className="grid4">
        <div>
          <label className="label">{t("harv.crop")}</label>
          <select className="input" value={crop} onChange={(e) => setCrop(e.target.value)}>
            <option value="fraise">🍓 {t("crop.fraise")}</option>
            <option value="framboise">🫐 {t("crop.framboise")}</option>
            <option value="avocat">🥑 {t("crop.avocat")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("harv.pickDate")}</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label">{t("harv.quality")}</label>
          <select className="input" value={quality} onChange={(e) => setQuality(e.target.value)}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div>
          <label className="label">{t("harv.qtyKg")}</label>
          <input
            className="input"
            type="number"
            min={0}
            value={qtyKg}
            onChange={(e) => setQtyKg(toNumber(e.target.value, 0))}
          />
        </div>
      </div>

      <div className="grid3 section">
        <div>
          <label className="label">{t("harv.pricePerKg")}</label>
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            value={price}
            onChange={(e) => setPrice(toNumber(e.target.value, 0))}
          />
        </div>

        <div className="pill" style={{ alignSelf: "end" }}>
          <p className="muted" style={{ margin: 0 }}>
            {t("prices.res.gross")}
          </p>
          <p style={{ margin: "6px 0 0 0", fontWeight: 700 }}>
            {nf(qtyKg * price)} {t("units.mad")}
          </p>
        </div>

        <div className="flex items-end">
          <button className="tab" onClick={addLog}>
            {t("harv.addLog")}
          </button>
        </div>
      </div>

      {ensureArray(logs).length > 0 && (
        <div className="section">
          <div className="overflow-x-auto">
            <table className="table-auto w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th>{t("harv.table.date")}</th>
                  <th>{t("harv.crop")}</th>
                  <th>{t("harv.quality")}</th>
                  <th>{t("harv.table.qty")}</th>
                  <th>{t("harv.table.price")}</th>
                  <th>{t("harv.table.total")}</th>
                </tr>
              </thead>
              <tbody>
                {ensureArray(logs).map((r, i) => {
                  const row = normalizeLog(r);
                  return (
                    <tr key={i}>
                      <td>{row.date}</td>
                      <td>{t(`crop.${row.crop}`)}</td>
                      <td>{row.quality}</td>
                      <td>{nf(row.qtyKg)} {t("units.kg")}</td>
                      <td>{nf(row.price)} {t("units.mad")}/{t("units.kg")}</td>
                      <td>{nf(row.total)} {t("units.mad")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid3 section">
            <div className="pill">
              <div className="muted">{t("harv.table.qty")}</div>
              <div style={{ fontWeight: 700 }}>{nf(totals.sumKg)} {t("units.kg")}</div>
            </div>
            <div className="pill">
              <div className="muted">{t("harv.table.total")}</div>
              <div style={{ fontWeight: 700 }}>{nf(totals.sumMAD)} {t("units.mad")}</div>
            </div>
            <div className="pill">
              <div className="muted">{t("harv.totalSeason")}</div>
              <div style={{ fontWeight: 700 }}>{nf(totals.sumMAD)} {t("units.mad")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
