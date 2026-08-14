const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3001;

const { clerkMiddleware, getAuth } = require('@clerk/express');

app.use(cors());
app.use(express.json());
app.use(clerkMiddleware());

// Clerk's requireAuth() was deprecated so replacing it w this
function requireUser(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}


app.get('/applications', requireUser, async (req, res) => {
    try {
        const userId = getAuth(req).userId;
        const applications = await prisma.application.findMany({
            where: { userId: userId },
        });
        res.json(applications);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Failed to load applications' });
    }
});

app.post('/applications', requireUser, async (req, res) => {
    try{
        const newApp = await prisma.application.create({
            data: {
                company: req.body.company,
                role: req.body.role,
                userId: getAuth(req).userId,
            },
        });
        res.json(newApp);
    } catch(error) {
        console.error(error);
        res.status(500).json({error: 'Failed to post applications'});
    }
});

app.patch('/applications/:id', requireUser, async (req, res) => {
    try{
        const idToChange = Number(req.params.id);
        const currUserId = getAuth(req).userId;
        const updatedApp = await prisma.application.updateMany({ where: {id: idToChange, userId: currUserId}, data : {status: req.body.newStatus }});
        if (updatedApp.count === 0) return res.status(404).json({error: 'Application not found'});
        res.json(updatedApp);
    } catch(error) {
        console.error(error);
        res.status(500).json({error : 'Failed to patch application'});
    }
})

app.delete('/applications/:id', requireUser, async (req, res) => {
    try{
        const idToRemove = Number(req.params.id);
        const currUserId = getAuth(req).userId;
        const removedApp = await prisma.application.deleteMany({ where : {id : idToRemove, userId: currUserId}});
        if (removedApp.count === 0) return res.status(404).json({error: 'Application not found'});
        res.json(removedApp);
    } catch(error){
        console.error(error);
        res.status(500).json({error: 'Failed to delete application'});
    }
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});