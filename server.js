require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });
let db;

(async () => {
    db = await open({
        filename: './kurye.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS lokasyonlar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tur TEXT,
            ad TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS firmalar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alicilar (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_soyad TEXT,
            telefon TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paketler (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            foto_path TEXT,
            lokasyon_id INTEGER,
            firma_id INTEGER,
            alici_id INTEGER,
            gonderici_tel TEXT,
            fiyat REAL,
            tarih DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const check = await db.get('SELECT COUNT(*) as count FROM lokasyonlar');
    if (check.count === 0) {
        await db.run("INSERT INTO lokasyonlar (tur, ad) VALUES ('otogar', 'Şehirlerarası Otogar')");
        await db.run("INSERT INTO lokasyonlar (tur, ad) VALUES ('ilce_garaj', 'İlçe Garajı')");
        await db.run("INSERT INTO firmalar (ad) VALUES ('Öz Yazıhane')");
        await db.run("INSERT INTO firmalar (ad) VALUES ('Lider Turizm')");
    }
})();

async function sendWhatsAppTemplate(toPhoneNumber, receiverName, yaziHaneInfo, basePrice = "200") {
    let formattedPhone = toPhoneNumber.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '90' + formattedPhone.substring(1);
    else if (!formattedPhone.startsWith('90')) formattedPhone = '90' + formattedPhone;

    const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;

    const payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
            name: "emanet_teslimat_logo",
            language: { code: "tr" },
            components: [
                {
                    type: "header",
                    parameters: [
                        {
                            type: "image",
                            image: { link: process.env.LOGO_URL || "https://via.placeholder.com/500x500.png?text=Logo" }
                        }
                    ]
                },
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: receiverName || "Müşterimiz" },
                        { type: "text", text: yaziHaneInfo },
                        { type: "text", text: String(basePrice) }
                    ]
                }
            ]
        }
    };

    return axios.post(url, payload, {
        headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });
}

app.get('/api/tanimlar', async (req, res) => {
    const lokasyonlar = await db.all('SELECT * FROM lokasyonlar ORDER BY tur, ad');
    const firmalar = await db.all('SELECT * FROM firmalar ORDER BY ad');
    res.json({ lokasyonlar, firmalar });
});

app.post('/api/lokasyon-ekle', async (req, res) => {
    const { tur, ad } = req.body;
    await db.run('INSERT INTO lokasyonlar (tur, ad) VALUES (?, ?)', [tur, ad]);
    res.json({ success: true });
});

app.post('/api/firma-ekle', async (req, res) => {
    const { ad } = req.body;
    await db.run('INSERT INTO firmalar (ad) VALUES (?)', [ad]);
    res.json({ success: true });
});

app.get('/api/alicilar/ara', async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const alicilar = await db.all('SELECT * FROM alicilar WHERE telefon LIKE ? OR ad_soyad LIKE ? LIMIT 10', [`%${q}%`, `%${q}%`]);
    res.json(alicilar);
});

app.post('/api/paket-kayit', upload.single('paketFoto'), async (req, res) => {
    try {
        const { aliciTel, aliciAd, gondericiTel, lokasyonId, firmaId, fiyat } = req.body;
        const fotoPath = req.file ? req.file.path : null;

        if (!aliciTel) return res.status(400).json({ success: false, message: 'رقم هاتف المستلم مطلوب' });

        let alici = await db.get('SELECT * FROM alicilar WHERE telefon = ?', [aliciTel]);
        if (!alici) {
            const result = await db.run('INSERT INTO alicilar (ad_soyad, telefon) VALUES (?, ?)', [aliciAd || 'زبون', aliciTel]);
            alici = { id: result.lastID };
        }

        const lokasyon = await db.get('SELECT * FROM lokasyonlar WHERE id = ?', [lokasyonId]);
        const firma = await db.get('SELECT * FROM firmalar WHERE id = ?', [firmaId]);
        const yaziHaneTamAd = `${lokasyon ? lokasyon.ad : ''} - ${firma ? firma.ad : ''}`;

        await db.run('INSERT INTO paketler (foto_path, lokasyon_id, firma_id, alici_id, gonderici_tel, fiyat) VALUES (?, ?, ?, ?, ?, ?)',
            [fotoPath, lokasyonId, firmaId, alici.id, gondericiTel, fiyat || 200]);

        await sendWhatsAppTemplate(aliciTel, aliciAd, yaziHaneTamAd, fiyat || 200);

        res.json({ success: true, message: 'تم حفظ الطرد وإرسال إشعار الواتساب بنجاح!' });
    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء إرسال الرسالة' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`السيرفر يعمل على البورت ${PORT}`));