import { useState, useEffect } from 'react';
import './App.css';
import { SignedIn, SignedOut, SignInButton, UserButton, useAuth } from '@clerk/clerk-react';


function App() {
  const [applications, setApplications] = useState([]);
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadApplications();
    }
  }, [isLoaded, isSignedIn]);

  async function handleSubmit(e) {
    e.preventDefault();

    const newApp = {
      company: company,
      role: role,
    };
    try{
      const token = await getToken();
      const response = await fetch(`${process.env.REACT_APP_API_URL}/applications`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
        body: JSON.stringify(newApp),
      });
      if (!response.ok) throw new Error("Failed to post applications");
      const savedApp = await response.json();
      setApplications([...applications, savedApp]);
      setCompany('');
      setRole('');
    } catch(error) {
      console.error(error);
      alert("Couldnt post applications");
    }
  }

  async function handleDelete(idToRemove){
    try {
      const token = await getToken();
      const response = await fetch(`${process.env.REACT_APP_API_URL}/applications/${idToRemove}`, {
        method: 'DELETE',
        headers: {'Authorization': `Bearer ${token}`},
      });
      if (!response.ok) throw new Error("Could not delete application");
      setApplications(applications.filter((app) => app.id !== idToRemove));
    } catch(error){
      console.error(error);
      alert("Could not delete application :(");
    }
  }

  async function handleStatusChange(idToChange, newStatus) {
    try {
      const token = await getToken();
      const response = await fetch(`${process.env.REACT_APP_API_URL}/applications/${idToChange}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
        body: JSON.stringify({newStatus: newStatus}),
      });
      if (!response.ok) throw new Error("Could not change status");
      setApplications(applications.map((app) => {
        if (idToChange === app.id){
        return {...app, status: newStatus};
        }
        else{
          return app;
        }
      }));
    } catch(error) {
      console.error(error);
      alert("Could not update status");
    }
  }

  async function loadApplications() {
    try {
      const token = await getToken();
      const response = await fetch(`${process.env.REACT_APP_API_URL}/applications`, {
        headers: {'Authorization': `Bearer ${token}`},
      });
      if (!response.ok) {
        throw new Error('Failed to load applications');
      }
      const data = await response.json();
      setApplications(data);
    } catch(error) {
      console.error(error);
      alert('Could not load applications. Please try again');
    }
  }

  return (
    <div className="App">
      <SignedOut>
        <h1>Job Applications</h1>
        <p>Sign in to track your applications</p>
        <SignInButton />
      </SignedOut>

      <SignedIn>
        <UserButton />
        <h1>Job Applications: {applications.length}</h1>
        <form onSubmit={handleSubmit} className="job-form">
          <input
            type="text"
            placeholder="Company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <input
            type="text"
            placeholder="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          {applications.map((app) => (
            <li key={app.id} className="job-item">
            {app.role} at {app.company} - {app.status}
            <button onClick={() => handleDelete(app.id)}>Delete</button>
            <select 
              value={app.status}
              onChange={(e) => handleStatusChange(app.id, e.target.value)}>
                <option value="Applied">Applied</option>
                <option value="Interviewing">Interviewing</option>
                <option value="Offered">Offered</option>
                <option value="Rejected">Rejected</option>
            </select>
            </li>
          ))}
          </ul>
        </SignedIn>
    </div>
  );
}

export default App;