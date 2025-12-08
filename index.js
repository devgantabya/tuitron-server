const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 5000;

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).send({ message: "Unauthorized" });

    const token = authHeader.split(" ")[1];
    try {
        const userInfo = await admin.auth().verifyIdToken(token);
        req.token_email = userInfo.email;
        req.token_uid = userInfo.uid;
        req.token_picture = userInfo.picture || null;
        next();
    } catch (err) {
        return res.status(401).send({ message: "Invalid token" });
    }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7smyhy0.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
    try {
        await client.connect();
        const db = client.db("tuitron_db");
        const usersCollection = db.collection("users");

        app.post("/users", verifyFirebaseToken, async (req, res) => {
            const email = req.token_email;

            let user = await usersCollection.findOne({ email });

            if (!user) {
                const newUser = {
                    uid: req.token_uid,
                    email,
                    name: req.body.name,
                    phone: req.body.phone,
                    role: req.body.role || "Student",
                    image: req.token_picture,
                };
                await usersCollection.insertOne(newUser);
                user = newUser;
            }

            res.send({ user });
        });

        app.get("/users", async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });

        console.log("MongoDB connected successfully!");
    } finally {
        // Do not close client while server is running
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Tuitron server is running"));

app.listen(port, () => console.log(`Server running on port: ${port}`));
