const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../data', file)));
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(__dirname, '../data', file), JSON.stringify(data, null, 2));
}

// Register user
app.post('/users', (req,res)=>{
  let users = readJson('users.json');
  users.push(req.body);
  writeJson('users.json', users);
  res.json(req.body);
});

// Login
app.post('/login', (req,res)=>{
  const { email, password } = req.body;
  let users = readJson('users.json');
  const user = users.find(u=>u.email===email && u.password===password);
  if(user){
    res.json({ message: "Login successful", user });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

// Add health service
app.post('/services', (req,res)=>{
  let services = readJson('services.json');
  services.push(req.body);
  writeJson('services.json', services);
  res.json(req.body);
});

// View all services
app.get('/services', (req,res)=> res.json(readJson('services.json')));

// Search services
app.get('/services/search', (req,res)=>{
  const { type, name, language } = req.query;
  let services = readJson('services.json');
  let results = services.filter(s=>{
    return (!type || s.type===type) &&
           (!name || s.name.toLowerCase().includes(name.toLowerCase())) &&
           (!language || s.languages.includes(language));
  });
  res.json(results);
});

// Share service
app.post('/services/share', (req,res)=>{
  let shares = readJson('shares.json');
  shares.push(req.body);
  writeJson('shares.json', shares);
  res.json(req.body);
});

// Recommendations
app.get('/recommendations', (req,res)=>{
  let services = readJson('services.json');
  const popular = services.filter(s=>s.popular);
  res.json(popular);
});

// Metrics
app.get('/metrics', (req,res)=>{
  res.json({
    users: readJson('users.json').length,
    services: readJson('services.json').length,
    shares: readJson('shares.json').length
  });
});

if (require.main === module) {
  app.listen(3000, ()=> console.log('Nyom Health API running on port 3000'));
}
module.exports = app;
