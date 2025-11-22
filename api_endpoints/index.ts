
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";
import axios from "axios";

admin.initializeApp();
const db = admin.firestore();
// IMPORTANT: Ensure a database named 'companion' exists in your Firestore console!
db.settings({ databaseId: 'companion' });
const app = express();

// 1. JSON Body Parser (Critical for POST requests)
app.use(express.json() as any);

// 2. CORS
app.use(cors({ origin: true }) as any);

// 3. Auth Middleware
const authenticate = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).send("Unauthorized: No token provided");
    return;
  }

  const accessToken = authHeader.split("Bearer ")[1];

  try {
    // Validate token with Google
    const response = await axios.get(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    req.user = response.data;
    next();
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(403).send("Unauthorized: Invalid token");
  }
};

app.use(authenticate);

// --- MEMORIES ENDPOINTS ---

app.get("/memories", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    // Fetch all and sort in memory to avoid index errors
    const snapshot = await db.collection(`users/${userId}/memories`).get();
    const memories = snapshot.docs.map(doc => doc.data());
    // Sort desc (newest first)
    memories.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(memories);
  } catch (e: any) {
    console.error("GET /memories Error:", e);
    res.status(500).send(e.message);
  }
});

app.post("/memories", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const memory = req.body;
    if (!memory || !memory.id) throw new Error("Invalid memory object: Missing ID");
    
    await db.doc(`users/${userId}/memories/${memory.id}`).set(memory);
    res.json({ success: true });
  } catch (e: any) {
    console.error("POST /memories Error:", e);
    res.status(500).send(e.message);
  }
});

app.delete("/memories/:id", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const memoryId = req.params.id;
    await db.doc(`users/${userId}/memories/${memoryId}`).delete();
    res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /memories Error:", e);
    res.status(500).send(e.message);
  }
});

// --- SEARCH HISTORY ENDPOINTS ---

app.get("/search_history", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    // Fetch raw collection, sort/limit in memory for safety
    const snapshot = await db.collection(`users/${userId}/search_history`).get();
    const history = snapshot.docs.map(doc => doc.data());
    
    // Sort desc (newest first)
    history.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Limit to 50
    res.json(history.slice(0, 50));
  } catch (e: any) {
    console.error("GET /search_history Error:", e);
    res.status(500).send(e.message);
  }
});

app.post("/search_history", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const item = req.body;
    if (!item || !item.id) throw new Error("Invalid search item: Missing ID");

    console.log(`Saving search item ${item.id} for ${userId}`);
    await db.doc(`users/${userId}/search_history/${item.id}`).set(item);
    res.json({ success: true });
  } catch (e: any) {
    console.error("POST /search_history Error:", e);
    res.status(500).send(e.message);
  }
});

app.delete("/search_history/:id", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const itemId = req.params.id;
    console.log(`Deleting search item ${itemId} for ${userId}`);
    await db.doc(`users/${userId}/search_history/${itemId}`).delete();
    res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /search_history/:id Error:", e);
    res.status(500).send(e.message);
  }
});

app.delete("/search_history", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const batch = db.batch();
    const snapshot = await db.collection(`users/${userId}/search_history`).get();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /search_history Error:", e);
    res.status(500).send(e.message);
  }
});

// --- SETTINGS ENDPOINTS ---

app.get("/settings", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const doc = await db.doc(`users/${userId}/settings/config`).get();
    res.json(doc.exists ? doc.data() : {});
  } catch (e: any) {
    console.error("GET /settings Error:", e);
    res.status(500).send(e.message);
  }
});

app.post("/settings", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const config = req.body;
    await db.doc(`users/${userId}/settings/config`).set(config);
    res.json({ success: true });
  } catch (e: any) {
    console.error("POST /settings Error:", e);
    res.status(500).send(e.message);
  }
});

// --- CHAT HISTORY ENDPOINTS ---

app.get("/chat_history", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const snapshot = await db.collection(`users/${userId}/chat_history`).get();
    const history = snapshot.docs.map(doc => doc.data());
    // Sort asc (oldest first) for chat log
    history.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    // Limit to last 100
    res.json(history.slice(-100));
  } catch (e: any) {
    console.error("GET /chat_history Error:", e);
    res.status(500).send(e.message);
  }
});

app.post("/chat_history", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const message = req.body;
    if (!message || !message.id) throw new Error("Invalid chat message: Missing ID");

    await db.doc(`users/${userId}/chat_history/${message.id}`).set(message);
    res.json({ success: true });
  } catch (e: any) {
    console.error("POST /chat_history Error:", e);
    res.status(500).send(e.message);
  }
});

app.delete("/chat_history", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const batch = db.batch();
    const snapshot = await db.collection(`users/${userId}/chat_history`).get();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /chat_history Error:", e);
    res.status(500).send(e.message);
  }
});

// --- NOTIFICATIONS ENDPOINTS ---

app.get("/notifications", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    // Fetch raw, filter/sort in memory to prevent 500 Index Errors
    const snapshot = await db.collection(`users/${userId}/notifications`).get();
    
    const notifications = snapshot.docs
        .map(doc => doc.data())
        .filter((n: any) => n.read === false)
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 20);
        
    res.json(notifications);
  } catch (e: any) {
    console.error("GET /notifications Error:", e);
    res.status(500).send(e.message);
  }
});

app.post("/notifications/:id/read", async (req: any, res: any) => {
  try {
    const userId = req.user.sub;
    const notificationId = req.params.id;
    await db.doc(`users/${userId}/notifications/${notificationId}`).update({ read: true });
    res.json({ success: true });
  } catch (e: any) {
    console.error("POST /notifications/read Error:", e);
    res.status(500).send(e.message);
  }
});

export const api = onRequest(app as any);
