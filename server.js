const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const levenshtein = require('fast-levenshtein');
const webPush = require("web-push");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: '*', // Change '*' to your frontend URL for security
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  
app.use(bodyParser.json());

// Database connections
const symptomsDB = new sqlite3.Database('./symptoms.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) console.error('Error connecting to symptoms database:', err.message);
    else console.log('Connected to symptoms.db.');
});

const remaindersDB = new sqlite3.Database('./reminders.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) console.error('Error connecting to remainders database:', err.message);
    else console.log('Connected to remainders.db.');
});


// API to check symptoms and provide advice
app.post('/api/symptom-checker', (req, res) => {
    const { symptoms } = req.body;

    if (!symptoms) {
        return res.status(400).json({ error: "Please enter symptoms to get advice." });
    }

    let userSymptoms = symptoms.toLowerCase()
        .replace(/[,]+/g, ' ')
        .replace(/\band\b|\b&\b/g, '')
        .trim()
        .split(/\s+/);

    symptomsDB.all('SELECT * FROM symptoms', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let matchedResponses = [];

        rows.forEach(row => {
            const dbSymptom = row.name.toLowerCase().trim();

            userSymptoms.forEach((_, index) => {
                let inputSegment = userSymptoms.slice(index, index + dbSymptom.split(' ').length).join(' ');
                const distance = levenshtein.get(inputSegment, dbSymptom);
                const threshold = dbSymptom.length > 6 ? 3 : 2;

                if (distance <= threshold) {
                    matchedResponses.push(row.response);
                }
            });
        });

        if (matchedResponses.length === 0) {
            return res.json({ advice: "No specific advice found. Please consult a doctor if symptoms persist." });
        }

        res.json({ advice: [...new Set(matchedResponses)] });
    });
});

// API to get the list of available symptoms
app.get('/api/symptoms-list', (req, res) => {
    symptomsDB.all('SELECT name FROM symptoms', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const symptomsList = rows.map(row => row.name);
        res.json({ symptoms: symptomsList });
    });
});

// Health Reminder Feature
const VAPID_KEYS = {
  publicKey: process.env.PUBLIC_VAPID_KEY,
  privateKey: process.env.PRIVATE_VAPID_KEY,
};

webPush.setVapidDetails(
  "mailto:your-email@example.com",
  VAPID_KEYS.publicKey,
  VAPID_KEYS.privateKey
); 


// Store user subscriptions in remainders.db
app.post("/subscribe", (req, res) => {
    console.log("Received Subscription:", req.body);
    
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: "Invalid subscription object" });
    }

    const query = `INSERT INTO subscriptions (endpoint, keys) VALUES (?, ?)`;
    remaindersDB.run(query, [endpoint, JSON.stringify(keys)], function (err) {
        if (err) {
            console.error("Error saving subscription:", err.message);
            return res.status(500).json({ error: "Database error" });
        }
        res.status(201).json({ message: "Subscribed!" });
    });
});




// Store reminders in remainders.db
app.post("/set-reminder", (req, res) => {
    const { time, message } = req.body;
    console.log("Reminder Request:", req.body);

    const reminderTime = new Date(time);
    if (isNaN(reminderTime)) {
        return res.status(400).json({ error: "Invalid date format" });
    }

    const delay = reminderTime - new Date();
    console.log(delay)
    if (delay <= 0) {
        return res.status(400).json({ error: "Time must be in the future" });
    }

    // Insert reminder into SQLite database
    const query = `INSERT INTO reminders (time, message) VALUES (?, ?)`;
    remaindersDB.run(query, [reminderTime.toISOString(), message], function (err) {
        if (err) {
            console.error("Error saving reminder:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        setTimeout(() => {
            console.log('test')
            sendNotification(message);
        }, delay);

        res.json({ message: "Reminder saved!" });
    });
});


// Send Push Notification
function sendNotification(message) {
    remaindersDB.all('SELECT * FROM subscriptions', [], (err, rows) => {
        if (err) {
            console.error("Error fetching subscriptions:", err.message);
            return;
        }
console.log(rows)
        rows.forEach(sub => {
            try {
                const subscription = {
                    endpoint: sub.endpoint,
                    keys: JSON.parse(sub.keys) // Ensure it's valid JSON
                };
                console.log("Received Subscription:", subscription);
                
                webPush.sendNotification(subscription, message)
                    .catch(err => console.error("Push Notification Error:", err));

            } catch (error) {
                console.error("Error parsing subscription keys:", error.message);
            }
        });
    });
}


// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
