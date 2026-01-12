const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require('stripe')(process.env.STRIPE_SECRET)
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
    const token = req.headers.authorization;

    if (!token) return res.status(401).send({ message: "Unauthorized" });

    const idToken = token.split(" ")[1];
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.user = decoded;
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
        const paymentsCollection = db.collection("payments");
        const applicationsCollection = db.collection("applications");

        // Middleware to verify Admin
        // Must be used after verifyFirebaseToken middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.user.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== "admin") {
                res.status(403).send({ message: "Forbidden access" });
                return;
            }
            next();
        }

        // User APIs
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })

            if (userExists) {
                return res.status(409).send({ message: "User already exists" });
            }

            const result = await usersCollection.insertOne(user);
            res.send({
                insertedId: result.insertedId,
                message: "User created successfully",
            });
        })

        app.get("/users", verifyFirebaseToken, async (req, res) => {
            const cursor = usersCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        })

        app.get("/users/:id", async (req, res) => {
            const id = req.params.id;
            try {
                const user = await usersCollection.findOne({ _id: new ObjectId(id) });
                if (!user) return res.status(404).send({ message: "User not found" });
                res.send(user);
            } catch {
                res.status(400).send({ message: "Invalid id" });
            }
        });

        app.get("/users/:email/role", async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user) {
                return res.send({ role: "user" });
            }
            res.send({ role: user?.role });
        })

        app.patch("/users/:id/role", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const roleInfo = req.body;
            const newRole = roleInfo.role;

            if (!["admin", "user", "tutor"].includes(newRole)) {
                return res.status(400).send({ message: "Invalid role" });
            }

            const query = { _id: new ObjectId(id) };
            const targetUser = await usersCollection.findOne(query);

            if (!targetUser) {
                return res.status(404).send({ message: "User not found" });
            }

            if (targetUser.role === "admin" && newRole !== "admin") {
                const adminCount = await usersCollection.countDocuments({
                    role: "admin",
                });

                if (adminCount <= 1) {
                    return res.status(400).send({
                        message: "At least one admin must remain in the system",
                    });
                }
            }

            if (
                targetUser.email === req.user.email &&
                targetUser.role === "admin" &&
                newRole !== "admin"
            ) {
                return res.status(400).send({
                    message: "Admin cannot change their own role",
                });
            }

            const updatedDoc = {
                $set: {
                    role: newRole,
                },
            };

            const result = await usersCollection.updateOne(query, updatedDoc);

            res.send({
                success: true,
                message: "Role updated successfully",
                result,
            });
        }
        );


        app.delete("/users/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const targetUser = await usersCollection.findOne(query);

            if (!targetUser) {
                return res.status(404).send({ message: "User not found" });
            }

            if (targetUser.role === "admin") {
                const adminCount = await usersCollection.countDocuments({
                    role: "admin",
                });

                if (adminCount <= 1) {
                    return res.status(400).send({
                        message: "At least one admin must remain in the system",
                    });
                }
            }

            if (targetUser.email === req.user.email) {
                return res.status(400).send({
                    message: "You cannot delete your own account",
                });
            }

            const result = await usersCollection.deleteOne(query);

            res.send({
                success: true,
                message: "User deleted successfully",
                result,
            });
        }
        );


        // Tuition APIs
        app.get("/tuitions", async (req, res) => {
            const {
                email,
                category,
                course,
                subject,
                location,
                salaryMin,
                salaryMax,
                method,
                gender,
            } = req.query;

            const query = {};

            if (email) {
                query["postedBy.email"] = email;
            }

            if (category) {
                query.category = category;
            }

            if (course) {
                query.course = course;
            }

            if (subject) {
                query.subject = subject;
            }

            if (method) {
                query.method = method;
            }

            if (gender) {
                query.gender = gender;
            }

            if (location) {
                query["contact.location"] = {
                    $regex: location,
                    $options: "i",
                };
            }

            if (salaryMin || salaryMax) {
                query.salary = {};
                if (salaryMin) query.salary.$gte = Number(salaryMin);
                if (salaryMax) query.salary.$lte = Number(salaryMax);
            }

            const result = await tuitionsCollection.find(query).toArray();
            res.send(result);
        });


        app.post("/tuitions", verifyFirebaseToken, async (req, res) => {
            const tuition = {
                ...req.body,
                postedBy: {
                    email: req.user.email,
                    uid: req.user.uid,
                },
                student_email: req.user.email,
                createdAt: new Date(),
            };
            const result = await tuitionsCollection.insertOne(tuition);
            res.send(result);
        });

        app.get("/latest-tuitions", async (req, res) => {
            const cursor = tuitionsCollection.find().sort({ createdAt: -1 }).limit(5);
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
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

        app.delete("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id), "postedBy.email": req.user.email };
            const result = await tuitionsCollection.deleteOne(query)
            res.send(result);
        });



        app.put("/tuitions/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const { subject, class_level, location, budget, schedule, details } = req.body;
            try {
                const result = await tuitionsCollection.updateOne(
                    { _id: new ObjectId(id), student_email: req.user.email },
                    { $set: { subject, class_level, location, budget, schedule, details } }
                );
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });


        // Tutor APIs
        app.get("/tutors", async (req, res) => {
            const query = {};

            if (req.query.status) {
                query.status = req.query.status;
            }
            const cursors = tutorsCollection.find(query);
            const result = await cursors.toArray();
            res.send(result);
        });

        app.get("/latest-tutors", async (req, res) => {
            const tutors = await tutorsCollection.find().sort({ createdAt: -1 }).limit(5).toArray();
            res.send({ tutors });
        });

        app.post("/tutors", async (req, res) => {
            const tutor = req.body;
            tutor.status = "pending";
            tutor.createdAt = new Date();

            const result = await tutorsCollection.insertOne(tutor);
            res.send(result);
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

        app.patch("/tutors/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            updatedDoc = {
                $set: {
                    status: status
                }
            }
            const result = await tutorsCollection.updateOne(query, updatedDoc);

            if (status === "approved") {
                const email = req.body.email;
                const userQuery = { email };
                const userUpdate = {
                    $set: {
                        role: "tutor"
                    }
                }
                await usersCollection.updateOne(userQuery, userUpdate);
            }

            res.send(result);
        });

        app.delete("/tutors/:id", verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await tutorsCollection.deleteOne({ _id: new ObjectId(id), email: req.user.email });
                res.send(result);
            } catch (err) {
                res.status(400).send({ message: "Invalid id" });
            }
        });


        //Payment related APIs
        app.post('/create-checkout-session', verifyFirebaseToken, async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.salary) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "BDT",
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.subject,
                            }
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.studentEmail,
                mode: 'payment',
                metadata: {
                    tuitionId: paymentInfo.tuitionId,
                    subject: paymentInfo.subject,
                    salary: paymentInfo.salary
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });
            res.send({ url: session.url })
        });

        app.patch("/payment-success", async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);

            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }
            const paymentExist = await paymentsCollection.findOne(query);

            if (paymentExist) {
                return res.send({ message: "Already Exist", transactionId })
            }

            if (session.payment_status === "paid") {
                const id = session.metadata.tuitionId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: "paid"
                    }
                }

                const result = await tuitionsCollection.updateOne(query, update);
                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    tuitionId: session.metadata.tuitionId,
                    subject: session.metadata.subject,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                }

                if (session.payment_status === "paid") {
                    const resultPayment = await paymentsCollection.insertOne(payment)
                    res.send({
                        success: true,
                        modifyTuition: result,
                        transactionId: session.payment_intent,
                        paymentInfo: resultPayment

                    });
                }
            }

            res.send({ success: false });
        })

        app.get("/payments", verifyFirebaseToken, async (req, res) => {
            const email = req.query.email;
            const query = {};

            if (email) {
                query.customerEmail = email;

                //email check
                if (email !== req.user.email) {
                    return res.status(403).send({ message: "Forbidden access" })
                }
            }

            const cursor = paymentsCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })

        //Application related APIs
        app.post("/applications", verifyFirebaseToken, async (req, res) => {
            try {
                const { tuitionId, message } = req.body;

                if (!tuitionId || !message) {
                    return res.status(400).send({ message: "Missing required fields" });
                }

                const tutorId = req.user.uid;
                const tutorEmail = req.user.email;

                const alreadyApplied = await applicationsCollection.findOne({
                    tuitionId: new ObjectId(tuitionId),
                    tutorId,
                });

                if (alreadyApplied) {
                    return res.status(409).send({
                        message: "You have already applied for this tuition",
                    });
                }

                const application = {
                    tuitionId: new ObjectId(tuitionId),
                    tutorId,
                    tutorEmail,
                    message,
                    status: "pending",
                    appliedAt: new Date(),
                };

                const result = await applicationsCollection.insertOne(application);

                res.status(201).send({
                    success: true,
                    message: "Application submitted successfully",
                    applicationId: result.insertedId,
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Server error" });
            }
        });

        //get applications by tutor
        app.get("/applications/my", verifyFirebaseToken, async (req, res) => {
            const tutorId = req.user.uid;

            const applications = await applicationsCollection
                .find({ tutorId })
                .sort({ appliedAt: -1 })
                .toArray();

            res.send(applications);
        });

        //get applications for a tuition(Admin/User)
        app.get("/applications/tuition/:tuitionId", async (req, res) => {
            const { tuitionId } = req.params;

            const applications = await applicationsCollection
                .find({ tuitionId: new ObjectId(tuitionId) })
                .sort({ appliedAt: -1 })
                .toArray();

            res.send(applications);
        });

        //Update Application Status (Admin)
        app.patch("/applications/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;

            const allowed = ["pending", "accepted", "rejected"];
            if (!allowed.includes(status)) {
                return res.status(400).send({ message: "Invalid status" });
            }

            const result = await applicationsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );

            res.send(result);
        });


        console.log("MongoDB connected successfully!");
    } finally {
        // keep connection open
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Tuitron server is running"));

app.listen(port, () => console.log(`Server running on port: ${port}`));
