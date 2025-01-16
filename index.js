require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const appointmentRoutes = require("./routes/appointmentRoutes");
const app = express();
const port = process.env.PORT || 3000;
const connectDB = require("./db/db");

connectDB();

app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(cors());
app.use("/appointment", appointmentRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
