const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());


app.get('/', (req, res) => {
  res.send('Server is running! hellooooooo');
});

app.get('/applications', async (req, res) => {
    try {
        const applications = await prisma.application.findMany();
        res.json(applications);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Failed to load applications' });
    }
});

app.post('/applications', async (req, res) => {
    try{
        const newApp = await prisma.application.create({
            data: {
                company: req.body.company,
                role: req.body.role,
            },
        });
        res.json(newApp);
    } catch(error) {
        console.error(error);
        res.status(500).json({error: 'Failed to post applications'});
    }
});

app.patch('/applications/:id', async (req, res) => {
    try{
        const idToChange = Number(req.params.id);
        const updatedApp = await prisma.application.update({ where: {id: idToChange}, data : {status: req.body.newStatus }});
        res.json(updatedApp);
    } catch(error) {
        console.error(error);
        res.status(500).json({error : 'Failed to patch application'});
    }
})

app.delete('/applications/:id', async (req, res) => {
    try{
        const idToRemove = Number(req.params.id);
        const removedApp = await prisma.application.delete({ where : {id : idToRemove}});
        res.json(removedApp);
    } catch(error){
        console.error(error);
        res.status(500).json({error: 'Failed to delete application'});
    }
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});