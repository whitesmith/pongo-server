require('dotenv').load();
var express = require('express');
var mongoose = require('mongoose');
var bodyParser = require('body-parser');
var path = require('path');
var http = require('http');
var ably_realtime = require('ably').Realtime;
var ably_rest = require('ably').Rest;

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
  started: {type: Boolean, default: false},
  closed_at: {type: Date},
  closed: {type: Boolean, default:false},
  creator: {type: String, default:""},
  area_eges: [{lat:Number, lon:Number}],
  ball: {position: {lat: Number, lon: Number}, direction: {lat: Number, lon: Number}},
  name: {type: String},
  players: [{name: String, points: Number, position: {lat: Number, lon: Number}, token: String}]
});

var Game = mongoose.model('Game', GameSchema);
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost/pongo");


// Controllers
app.get('/', function (req, res) {
  Game.find({closed:false}, null, {}, function(err, games) {
    if (err) {
      console.log(err);
    } else {
      res.send(games);
    }
  });
});

// body name, player_name, lat, lon, area_edges: [{lat:Number, lon:Number}]
app.post("/create", function(req, res){
  Game.remove({}, function(){});
  client_rest.auth.requestToken(function(err, tokenDetails) {
    var player = {name: req.body.player_name, points:0, position: {lat: req.body.lat, lon: req.body.lon}, token: tokenDetails.token}
    var data = {name: req.body.name, players:[player], creator: player.name, area_edges: req.body.area_edges }
    var newgame = new Game(data);
    //newgame.started = true;
    newgame.save(function (err) {
      if (err) {
        console.log(err);
      } else {
        res.send({game:newgame, token: tokenDetails.token});
      }
    });
  });
});

// param: id
// body: name, lat, lon
app.post("/join/:id", function(req, res){
  client_rest.auth.requestToken(function(err, tokenDetails) {
    var data = {name: req.body.name, points:0, position: {lat: req.body.lat, lon: req.body.lon}, token: tokenDetails.token}
    Game.findOne({_id:req.params.id}, null, {}, function(err, game) {
      if (err) {
        console.log(err);
      } else {
        game.players.push(data)
        game.save(function (err) {
          if (err) {
            console.log(err);
          } else {
            res.send(game);
          }
        });
      }
    })
  });
});


//Ably Stuff
var client_rest = new ably_rest(process.env.ABLY_KEY)
var client_realtime = new ably_realtime(process.env.ABLY_KEY)

client_realtime.connection.on('connected', function() {
  console.log("Connected to ably");

  var channel = client_realtime.channels.get('pongo');

  channel.subscribe("new-location", function(message) {
    console.log('new-location message');
    var name = message.name;
    var lat = message.lat;
    var lon = message.lon;
    Game.findOne({}, null, {}, function(err, game) {
      for(var i=0; i<game.players.lenght; i++){
        if (game.players[i].name === name){
          game.players[i].position = {lat:lat, lon:lon};
          break;
        }
      }
    });
  });

  channel.subscribe("start-game", function(message) {
    console.log('game started message');
    var name = message.namel;
    Game.findOne({started: true}, null, {}, function(err, game) {
      game.started = true
      game.save(function (err) {})
    });
    // Set ball and forward information
  });

  channel.subscribe("new-ball-dir", function(message) {
    console.log('ball changed direction');
    var name = message.name
  });

  //thicks broacast stuff
  var i = setInterval(function(){
    Game.findOne({}, null, {}, function(err, game) {
      // console.log(game)
      // console.log(game.started)
      if (game){
        if (game.started){
          //Ball outside area
          //publish new points an put ball on center with random direction
          //publish last positions
          // If score >= 5 close game
        }
        channel.publish('locations', {ball: {}, players:game.players });
        console.log("players published");
      }
    });
  }, 1000);
});

client_realtime.connection.on('failed', function() {
  console.log("Failed to connect to ably");
});

// Start Server
var server = http.createServer(app);
server.listen(port);
