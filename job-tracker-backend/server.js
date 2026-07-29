const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

let applications = [
  { id: 1, company: 'Google', role: 'SWE Intern', status: 'Applied' },
  { id: 2, company: 'Meta', role: 'Frontend Dev', status: 'Applied' },
];



app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.get('/applications', (req, res) => {
    res.json(applications)
});

app.post('/applications', (req, res) => {
    applications.push(req.body);
    res.json({message: 'Recieved'});
});

app.patch('/applications/:id', (req, res) => {
    const idToChange = Number(req.params.id);
    applications = applications.map((app) => {
        if (app.id === idToChange) return {...app, status: req.body.newStatus};
        else return app;
    })
    res.json({message: 'Recieved'});
})

app.delete('/applications/:id', (req, res) => {
    const idToRemove = Number(req.params.id);
    applications = applications.filter((app) => app.id !== idToRemove);
    res.json({message: 'Recieved'});
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});