const express = require('express');
const { getAuth } = require('@clerk/express');
const prisma = require('../prisma');
const { requireUser } = require('../middleware');

const router = express.Router();

router.get('/', requireUser, async (req, res) => {
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

router.post('/', requireUser, async (req, res) => {
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

router.patch('/:id', requireUser, async (req, res) => {
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

router.delete('/:id', requireUser, async (req, res) => {
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

module.exports = router;
