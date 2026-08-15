const express = require('express');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');
const applicationsRouter = require('./routes/applications');
const { router: listingsRouter } = require('./routes/listings');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

app.use('/applications', applicationsRouter);
app.use('/listings', listingsRouter);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
