// fetch-aqi.js
const fs = require('fs');

async function run() {
    console.log("🤖 Starting Data Fetcher...");
    
    let airData = {};
    let postData = null;

    // --- 1. ดึงข้อมูล Air4Thai ---
    try {
        console.log("Fetching Air4Thai...");
        // ใช้ Region 1 (กทม.)
        const res = await fetch('http://air4thai.pcd.go.th/services/getNewAQI_JSON.php?region=1', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        if (!res.ok) throw new Error("Air4Thai Connection Failed");
        
        const data = await res.json();
        const stations = data.stations || data;

        // 🎯 สูตรค้นหาเดิม: หลักสี่ (bkp97t) -> บางเขน (bkp53t)
        let target = stations.find(s => s.stationID === "bkp97t");
        if (!target) {
            console.log("⚠️ หลักสี่ not found, switching to Bang Khen...");
            target = stations.find(s => s.stationID === "bkp53t" || s.nameTH.includes("บางเขน"));
        }

        if (!target) throw new Error("No station found");

        // จัดฟอร์แมตข้อมูล
        const getVal = (v) => (v && v.value && v.value !== "-" && v.value !== "N/A") ? v.value : "-";
        const getAqi = () => {
             if (target.LastUpdate?.AQI?.aqi && target.LastUpdate.AQI.aqi !== "-") return target.LastUpdate.AQI.aqi;
             if (target.AQI?.aqi && target.AQI.aqi !== "-") return target.AQI.aqi;
             return "-";
        };
        
        const getStatus = (lvl) => {
            const levels = ["", "คุณภาพดีมาก", "คุณภาพดี", "ปานกลาง", "เริ่มมีผลกระทบ", "มีผลกระทบต่อสุขภาพ"];
            return levels[lvl] || "รอข้อมูล";
        };

        airData = {
            source: 'Air4Thai (GitHub)',
            aqi: getAqi(),
            pm25: getVal(target.LastUpdate.PM25),
            pm10: getVal(target.LastUpdate.PM10),
            o3: getVal(target.LastUpdate.O3),
            status: target.LastUpdate?.AQI?.Level ? getStatus(target.LastUpdate.AQI.Level) : "รอข้อมูล",
            time: (target.LastUpdate.date + " " + target.LastUpdate.time),
            location: target.nameTH
        };
        console.log("✅ Air4Thai Success");

    } catch (e) {
        console.error("❌ Air4Thai Failed:", e.message);
        // Fallback: OpenMeteo
        try {
            console.log("🔄 Switching to OpenMeteo...");
            const om = await fetch('https://air-quality-api.open-meteo.com/v1/air-quality?latitude=13.887&longitude=100.579&current=pm2_5,pm10,ozone,us_aqi&timezone=Asia%2FBangkok').then(r => r.json());
            const aqi = om.current.us_aqi;
            let st = "ปานกลาง";
            if(aqi<=50) st="คุณภาพดีมาก"; else if(aqi<=100) st="คุณภาพดี"; else if(aqi>150) st="เริ่มมีผลกระทบ"; else if(aqi>200) st="มีผลกระทบ";
            
            airData = {
                source: 'OpenMeteo (Backup)',
                aqi: aqi,
                pm25: om.current.pm2_5,
                pm10: om.current.pm10,
                o3: om.current.ozone,
                status: st,
                time: om.current.time.replace('T', ' '),
                location: "หลักสี่ (Backup)"
            };
        } catch (err) {
            airData = { error: "Unavailable" };
        }
    }

    // --- 2. ดึงข้อมูล Google Sheet ---
    try {
        console.log("Fetching Google Sheet...");
        const sheetRes = await fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vSoa90gy2q_JHhquiUHEYcJA_O-JI0ntib_9NG8heNoGv-GEtco9Bv-bWiSib3vrg7E85Dz5H7JnlWO/pub?gid=0&single=true&output=csv');
        const text = await sheetRes.text();
        const rows = text.split(/\r?\n/);
        // (Logic เดิม)
        if (rows.length > 1) {
            let lastRow = rows[rows.length - 1] || rows[rows.length - 2];
            if (lastRow) {
                // Parse CSV ง่ายๆ
                const cols = lastRow.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
                if(cols.length >= 3) {
                    postData = {
                        timestamp: cols[0],
                        type: cols[1],
                        title: cols[2] || 'ประกาศ',
                        fileUrl: cols[3] || '#'
                    };
                }
            }
        }
        console.log("✅ Sheet Success");
    } catch (e) { console.error("Sheet Failed", e); }

    // --- 3. บันทึกลงไฟล์ data.json ---
    const finalData = {
        updated_at: new Date().toISOString(),
        air: airData,
        post: postData
    };

    fs.writeFileSync('data.json', JSON.stringify(finalData, null, 2));
    console.log("🎉 Data saved to data.json");
}

run();