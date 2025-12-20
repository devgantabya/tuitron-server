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
        const info = await admin.auth().verifyIdToken(idToken);
        req.token_email = info.email;
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
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: "User exist" })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        // Tuition APIs
        app.get("/tuitions", async (req, res) => {
            const query = {};
            const { email } = req.query;

            if (email) {
                query["postedBy.email"] = email;
            }

            const cursor = tuitionsCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        });

        app.post("/tuitions", async (req, res) => {
            const tuition = req.body;
            tuition.createdAt = new Date();
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

        app.delete("/tuitions/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await tuitionsCollection.deleteOne(query)
            res.send(result);
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

        app.patch("/tutors/:id", verifyFirebaseToken, async (req, res) => {
            const status = req.body.status;
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            updatedDoc = {
                $set: {
                    status: status
                }
            }
            const result = await tutorsCollection.updateOne(query, updatedDoc);
            res.send(result);
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


        //Payment related APIs
        app.post('/create-checkout-session', async (req, res) => {
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
                if (email !== req.token_email) {
                    return res.status(403).send({ message: "Forbidden access" })
                }
            }

            const cursor = paymentsCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })

        console.log("MongoDB connected successfully!");
    } finally {
        // keep connection open
    }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("Tuitron server is running"));

app.listen(port, () => console.log(`Server running on port: ${port}`));
