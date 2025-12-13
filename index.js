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
    origin: [process.env.SITE_DOMAIN, "http://localhost:5173"],
    credentials: true,
}));
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
        // await client.connect();
        const db = client.db("tuitron_db");
        const usersCollection = db.collection("users");
        const tuitionsCollection = db.collection("tuitions");
        const tutorsCollection = db.collection("tutors");
        const applicationsCollection = db.collection("applications");
        const paymentsCollection = db.collection("payments");

        // User APIs
        app.post("/users/register", async (req, res) => {
            const { name, email, phone, role, image } = req.body;
            if (!name || !email || !phone) return res.status(400).send({ message: "Missing required fields" });
            try {
                let user = await usersCollection.findOne({ email });
                if (!user) {
                    const newUser = { uid: null, email, name, phone, role: role || "Student", image: image || null };
                    await usersCollection.insertOne(newUser);
                    user = newUser;
                }
                res.status(201).send({ user });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to create user" });
            }
        });

        app.post("/users/google", async (req, res) => {
            const { name, email, image, uid } = req.body;
            if (!email || !uid) return res.status(400).send({ message: "Missing uid or email" });
            try {
                let user = await usersCollection.findOne({ email });
                if (!user) {
                    const newUser = { uid, email, name, phone: "", role: "Student", image };
                    await usersCollection.insertOne(newUser);
                    user = newUser;
                }
                res.status(200).send({ user });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to login with Google" });
            }
        });

        app.post("/users", verifyFirebaseToken, async (req, res) => {
            const email = req.token_email;
            let user = await usersCollection.findOne({ email });
            if (!user) {
                const newUser = { uid: req.token_uid, email, name: req.body.name, phone: req.body.phone || "", role: req.body.role || "Student", image: req.token_picture };
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

        // Tuition APIs
        app.get("/tuitions", async (req, res) => {
            try {
                const {
                    email,
                    course,
                    subject,
                    location,
                    salaryMin,
                    salaryMax,
                } = req.query;

                const query = {};

                if (email) {
                    query["postedBy.email"] = email;
                }

                if (course) {
                    query.course = course;
                }

                if (subject) {
                    query.subject = subject;
                }

                if (location) {
                    query["contact.location"] = { $regex: location, $options: "i" };
                }

                if (salaryMin || salaryMax) {
                    query.salary = {};
                    if (salaryMin) query.salary.$gte = Number(salaryMin);
                    if (salaryMax) query.salary.$lte = Number(salaryMax);
                }

                const tuitions = await tuitionsCollection.find(query).toArray();

                res.status(200).send({
                    success: true,
                    tuitions,
                });
            } catch (error) {
                console.error("Failed to fetch tuitions:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to fetch tuitions",
                });
            }
        });

        app.post("/tuitions", async (req, res) => {
            const tuition = req.body;
            const result = await tuitionsCollection.insertOne(tuition);
            res.send(result);
        });

        app.get("/latest-tuitions", async (req, res) => {
            const cursor = tuitionsCollection.find().sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
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

        // Tutor APIs
        app.get("/tutors", async (req, res) => {
            const tutors = await tutorsCollection.find().toArray();
            res.send({ tutors });
        });

        app.get("/latest-tutors", async (req, res) => {
            const tutors = await tutorsCollection.find().sort({ createdAt: -1 }).limit(5).toArray();
            res.send({ tutors });
        });

        app.post("/tutors", verifyFirebaseToken, async (req, res) => {
            const { name, email, qualifications, experience, subjects, class_levels, location, expected_salary, image } = req.body;
            if (!name || !email || !subjects || !class_levels || !location)
                return res.status(400).send({ message: "Missing required fields" });
            const newTutor = { name, email, qualifications: qualifications || "", experience: experience || "", subjects, class_levels, location, expected_salary: expected_salary || 0, image: image || null, createdAt: new Date() };
            const result = await tutorsCollection.insertOne(newTutor);
            res.status(201).send({ tutor: { _id: result.insertedId, ...newTutor } });
        });

        app.get("/tutors/:id", async (req, res) => {
            const { id } = req.params;
            try {
                const tutor = await tutorsCollection.findOne({ _id: new ObjectId(id) });
                if (!tutor) return res.status(404).send({ message: "Tutor not found" });
                res.send(tutor);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to fetch tutor" });
            }
        });

        app.put("/tutors/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await tutorsCollection.updateOne({ _id: new ObjectId(id), email: req.token_email }, { $set: req.body });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        app.delete("/tutors/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await tutorsCollection.deleteOne({ _id: new ObjectId(id), email: req.token_email });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });


        // Student APIs
        app.get("/student", verifyFirebaseToken, async (req, res) => {
            try {
                const email = req.token_email;
                const tuitions = await tuitionsCollection.find({ student_email: email }).toArray();
                res.send(tuitions);
            } catch (err) {
                console.error(err);
                res.status(500).send([]);
            }
        });

        app.post("/student", verifyFirebaseToken, async (req, res) => {
            try {
                const email = req.token_email;
                const { subject, classLevel, location, budget, schedule, details } = req.body;

                if (!subject || !classLevel || !location || !budget || !schedule)
                    return res.status(400).send({ message: "All fields required" });

                const newTuition = {
                    student_email: email,
                    subject,
                    classLevel,
                    location,
                    budget,
                    schedule,
                    details: details || "",
                    status: "Pending",
                    createdAt: new Date(),
                };

                const result = await tuitionsCollection.insertOne(newTuition);
                res.status(201).send({ _id: result.insertedId, ...newTuition });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: "Failed to create tuition" });
            }
        });

        app.put("/student/:id", verifyFirebaseToken, async (req, res) => {
            try {
                const { id } = req.params;
                const email = req.token_email;

                const updateData = req.body;
                const result = await tuitionsCollection.updateOne(
                    { _id: new ObjectId(id), student_email: email },
                    { $set: updateData }
                );

                res.send(result);
            } catch (err) {
                console.error(err);
                res.status(400).send({ message: "Invalid tuition id" });
            }
        });

        app.delete("/student/:id", verifyFirebaseToken, async (req, res) => {
            try {
                const { id } = req.params;
                const email = req.token_email;

                const result = await tuitionsCollection.deleteOne({
                    _id: new ObjectId(id),
                    student_email: email,
                });

                res.send(result);
            } catch (err) {
                console.error(err);
                res.status(400).send({ message: "Invalid tuition id" });
            }
        });

        app.get("/student/:id/applications", verifyFirebaseToken, async (req, res) => {
            try {
                const { id } = req.params;
                const applications = await applicationsCollection
                    .find({ tuition_id: new ObjectId(id) })
                    .toArray();

                res.send(applications);
            } catch (err) {
                console.error(err);
                res.status(500).send([]);
            }
        });

        app.put("/student/:tuitionId/applications/:appId", verifyFirebaseToken, async (req, res) => {
            try {
                const { tuitionId, appId } = req.params;
                const { action } = req.body;

                if (!["approve", "reject"].includes(action))
                    return res.status(400).send({ message: "Invalid action" });

                const newStatus = action === "approve" ? "Approved" : "Rejected";
                const result = await applicationsCollection.updateOne(
                    { _id: new ObjectId(appId), tuition_id: new ObjectId(tuitionId) },
                    { $set: { status: newStatus } }
                );

                res.send(result);
            } catch (err) {
                console.error(err);
                res.status(400).send({ message: "Failed to update application" });
            }
        });

        console.log("MongoDB connected successfully!");
    } finally {
        // keep connection open
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Tuitron server is running"));

app.listen(port, () => console.log(`Server running on port: ${port}`));
