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

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
}));
app.use(express.json());

const verifyFirebaseToken = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).send({ message: "Unauthorized" });
    const token = header.split(" ")[1];
    // console.log("Verifying token:", token);
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
            const { subject, class_level, location, budget, schedule, details } = req.body;
            const student_email = req.token_email;

            if (!subject || !class_level || !location || !budget || !schedule)
                return res.status(400).send({ message: "All fields required" });

            const newTuition = {
                student_email,
                subject,
                class_level,
                location,
                budget,
                schedule,
                details: details || "",
                status: "Pending",
                createdAt: new Date(),
            };

            const result = await tuitionsCollection.insertOne(newTuition);
            res.status(201).send({ tuition: { _id: result.insertedId, ...newTuition } });
        });

        app.get("/tuitions", async (req, res) => {
            const { singleId } = req.query;

            if (singleId) {
                try {
                    const t = await tuitionsCollection.findOne({ _id: new ObjectId(singleId) });
                    return res.send({ tuitions: t ? [t] : [] });
                } catch (err) {
                    return res.status(400).send({ tuitions: [] });
                }
            }

            const tuitions = await tuitionsCollection.find().toArray();
            res.send({ tuitions });
        });

        app.get("/tuitions/:id", async (req, res) => {
            const { id } = req.params;

            try {
                const tuition = await tuitionsCollection.findOne({ _id: new ObjectId(id) });
                if (!tuition) return res.status(404).send({ message: "Tuition not found" });
                res.send(tuition);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to fetch tuition" });
            }
        });

        app.put("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { subject, class_level, location, budget, schedule, details } = req.body;

            try {
                const result = await tuitionsCollection.updateOne(
                    { _id: new ObjectId(id), student_email: req.token_email },
                    { $set: { subject, class_level, location, budget, schedule, details } }
                );
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        app.delete("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await tuitionsCollection.deleteOne({ _id: new ObjectId(id), student_email: req.token_email });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        // Applications APIs
        app.post("/applications/:tuitionId", verifyFirebaseToken, async (req, res) => {
            const { tuitionId } = req.params;
            const { qualifications, experience, expected_salary } = req.body;

            const tutor_email = req.token_email;
            const name = req.body.name || req.body.tutorName || req.token_email;

            const newApp = {
                tuition_id: new ObjectId(tuitionId),
                tutor_email,
                name,
                qualifications: qualifications || "",
                experience: experience || "",
                expected_salary: expected_salary || 0,
                status: "Pending",
                createdAt: new Date(),
            };

            const result = await applicationsCollection.insertOne(newApp);
            res.status(201).send({ application: { _id: result.insertedId, ...newApp } });
        });

        app.get("/applications/:tuitionId", verifyFirebaseToken, async (req, res) => {
            const { tuitionId } = req.params;
            try {
                const applications = await applicationsCollection.find({ tuition_id: new ObjectId(tuitionId) }).toArray();
                res.send({ applications });
            } catch (err) {
                res.status(400).send({ applications: [] });
            }
        });

        app.put("/applications/:id/status", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            try {
                const result = await applicationsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        // Student APIs
        app.get("/student", verifyFirebaseToken, async (req, res) => {
            const email = req.token_email;

            const tuitions = await tuitionsCollection
                .find({ student_email: email })
                .toArray();

            res.send(tuitions);
        });

        app.post("/student", verifyFirebaseToken, async (req, res) => {
            const email = req.token_email;
            const data = req.body;

            const newTuition = {
                ...data,
                student_email: email,
                status: "Pending",
                createdAt: new Date(),
            };

            const result = await tuitionsCollection.insertOne(newTuition);

            res.send({ _id: result.insertedId, ...newTuition });
        });

        app.put("/student/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const email = req.token_email;

            const result = await tuitionsCollection.updateOne(
                { _id: new ObjectId(id), student_email: email },
                { $set: req.body }
            );

            res.send(result);
        });

        app.delete("/student/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const email = req.token_email;

            const result = await tuitionsCollection.deleteOne({
                _id: new ObjectId(id),
                student_email: email,
            });

            res.send(result);
        });

        app.get("/student/:id/applications", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;

            const apps = await applicationsCollection
                .find({ tuition_id: new ObjectId(id) })
                .toArray();

            res.send(apps);
        });

        app.put("/student/:tid/applications/:aid", verifyFirebaseToken, async (req, res) => {
            const { tid, aid } = req.params;
            const { action } = req.body;

            if (!["approve", "reject"].includes(action)) {
                return res.status(400).send({ message: "Invalid action" });
            }

            const newStatus = action === "approve" ? "Approved" : "Rejected";

            const result = await applicationsCollection.updateOne(
                { _id: new ObjectId(aid), tuition_id: new ObjectId(tid) },
                { $set: { status: newStatus } }
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
            try {
                const result = await usersCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateData });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        app.delete("/admin/users/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        app.put("/admin/tuitions/:id/status", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body; // Approved / Rejected
            try {
                const result = await tuitionsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        console.log("MongoDB connected successfully!");
    } finally {
        // Keep connection open
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Tuitron server is running"));

app.listen(port, () => console.log(`Server running on port: ${port}`));
