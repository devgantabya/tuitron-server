const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).send({ message: "Unauthorized" });
    const token = header.split(" ")[1];
    try {
        const info = await admin.auth().verifyIdToken(token);
        req.token_email = info.email;
        req.token_uid = info.uid;
        req.token_picture = info.picture || null;
        next();
    } catch {
        return res.status(401).send({ message: "Invalid token" });
    }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.7smyhy0.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    },
});

async function run() {
    try {
        await client.connect();
        const db = client.db("tuitron_db");
        const usersCollection = db.collection("users");
        const tuitionsCollection = db.collection("tuitions");
        const applicationsCollection = db.collection("applications");
        const paymentsCollection = db.collection("payments");

        // User APIs
        app.post("/users/register", async (req, res) => {
            const { name, email, phone, role } = req.body;
            if (!name || !email || !phone) {
                return res.status(400).send({ message: "Missing required fields" });
            }
            try {
                let user = await usersCollection.findOne({ email });
                if (!user) {
                    const newUser = {
                        uid: null,
                        email,
                        name,
                        phone,
                        role: role || "Student",
                        image: null,
                    };
                    await usersCollection.insertOne(newUser);
                    user = newUser;
                }
                res.status(201).send({ user });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to create user" });
            }
        });

        app.post("/users", verifyFirebaseToken, async (req, res) => {
            const email = req.token_email;
            let user = await usersCollection.findOne({ email });
            if (!user) {
                const newUser = {
                    uid: req.token_uid,
                    email,
                    name: req.body.name,
                    phone: req.body.phone || "",
                    role: req.body.role || "Student",
                    image: req.token_picture,
                };
                await usersCollection.insertOne(newUser);
                user = newUser;
            }
            res.send({ user });
        });

        app.get("/users/role/:email", verifyFirebaseToken, async (req, res) => {
            const { email } = req.params;
            const user = await usersCollection.findOne({ email });
            if (!user) return res.status(404).send({ message: "User not found" });
            res.send({ email: user.email, role: user.role });
        });

        // tuitions APIs
        app.post("/tuitions", verifyFirebaseToken, async (req, res) => {
            const { subject, class: className, location, budget, schedule } = req.body;
            const student_email = req.token_email;

            if (!subject || !className || !location || !budget || !schedule)
                return res.status(400).send({ message: "All fields required" });

            const newTuition = {
                student_email,
                subject,
                class: className,
                location,
                budget,
                schedule,
                status: "Pending",
                createdAt: new Date()
            };

            await tuitionsCollection.insertOne(newTuition);
            res.status(201).send({ tuition: newTuition });
        });

        app.get("/tuitions", verifyFirebaseToken, async (req, res) => {
            const { role } = req.query;
            const email = req.token_email;

            let filter = {};
            if (role === "Student") filter = { student_email: email };
            const tuitions = await tuitionsCollection.find(filter).toArray();
            res.send({ tuitions });
        });

        app.put("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { subject, class: className, location, budget, schedule } = req.body;

            const result = await tuitionsCollection.updateOne(
                { _id: new ObjectId(id), student_email: req.token_email },
                { $set: { subject, class: className, location, budget, schedule } }
            );
            res.send(result);
        });

        app.delete("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const result = await tuitionsCollection.deleteOne({ _id: new ObjectId(id), student_email: req.token_email });
            res.send(result);
        });

        // Applications APIs
        app.post("/applications/:tuitionId", verifyFirebaseToken, async (req, res) => {
            const { tuitionId } = req.params;
            const { qualifications, experience, expected_salary } = req.body;

            const tutor_email = req.token_email;
            const name = req.body.name || req.token_email;

            const newApp = {
                tuition_id: new ObjectId(tuitionId),
                tutor_email,
                name,
                qualifications,
                experience,
                expected_salary,
                status: "Pending",
                createdAt: new Date()
            };

            await applicationsCollection.insertOne(newApp);
            res.status(201).send({ application: newApp });
        });

        app.get("/applications/:tuitionId", verifyFirebaseToken, async (req, res) => {
            const { tuitionId } = req.params;
            const applications = await applicationsCollection.find({ tuition_id: new ObjectId(tuitionId) }).toArray();
            res.send({ applications });
        });

        app.put("/applications/:id/status", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;

            const result = await applicationsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );
            res.send(result);
        });

        // Admin APIs
        app.get("/admin/users", verifyFirebaseToken, async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send({ users });
        });

        app.put("/admin/users/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const updateData = req.body;
            const result = await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
            res.send(result);
        });

        app.delete("/admin/users/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        app.put("/admin/tuitions/:id/status", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body; // Approved / Rejected
            const result = await tuitionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });
            res.send(result);
        });

        console.log("MongoDB connected successfully!");
    } finally {
        // Keep connection open
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Tuitron server is running"));

app.listen(port, () => console.log(`Server running on port: ${port}`));
