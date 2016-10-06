var express = require('express');
var mongoose = require('mongoose');
var bodyParser = require('body-parser');
var path = require('path');
var http = require('http');

var app = express();
var port = process.env.PORT || '3000';

app.set('port', port);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Models
// Set Database and Schemas
var GameSchema = new mongoose.Schema({
  created_at: {type: Date, default: Date.now},
  started_at: {type: Date},
  closed_at: {type: Date},
  closed: {type: Boolean, default:false},
  name: {type: String},
  ably_key: {type: String},
  players: [{name: String, points: Number, position: {lat: Number, lon: Number}}]
});

var Game = mongoose.model('Game', GameSchema);
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost/pongo");


// Controllers
app.get('/', function (req, res) {
  Game.find({closed:false}, null, {sort: 'date'}, function(err, games) {
    if (err) {
      console.log(err);
    } else {
      res.send(games);
    }
  });
});

app.post("/create", function(req, res){
  var data = {name: req.body.name}
  var newgame = new Game(data);
  newgame.save(function (err) {
    if (err) {
      console.log(err);
    } else {
      res.send(newgame);
    }
  });
});

app.post("/join/:id", function(req, res){

});


//Ably Stuff


// Start Server
var server = http.createServer(app);
server.listen(port);
