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
  area_edges: [{lat:Number, lon:Number}],
  ball: {position: {lat: Number, lon: Number}, direction: {lat: Number, lon: Number}},
  last_play: {player: String, position: {lat: Number, lon: Number}},
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
    var player = {name: req.body.player_name, points:0, position: {lat: req.body.lat, lon: req.body.lon}, token: tokenDetails.token};
    var data = {name: req.body.name, players:[player], creator: player.name, area_edges: req.body.area_edges };
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
        game.players.push(data);
        game.save(function (err) {
          if (err) {
            console.log(err);
          } else {
            res.send({game:game, token: tokenDetails.token});
          }
        });
      }
    })
  });
});


//Ably Stuff
var client_rest = new ably_rest(process.env.ABLY_KEY);
var client_realtime = new ably_realtime(process.env.ABLY_KEY);

client_realtime.connection.on('connected', function() {
  console.log("Connected to ably");

  var channel = client_realtime.channels.get('pongo');

  channel.subscribe("new-location", function(message) {
    console.log('new-location message');
    var data = JSON.parse(message.data);
    var name = data.name;
    var lat = data.lat;
    var lon = data.lon;
    Game.findOne({}, null, {}, function(err, game) {
      if(game) {
        for (var i = 0; i < game.players.length; i++) {
          if (game.players[i].name === name) {
            game.players[i].position = {lat: lat, lon: lon};
            break;
          }
        }
        game.save(function (err) {});
      }
    });
  });

  channel.subscribe("start-game", function(message) {
    console.log('game started message');
    Game.findOne({}, null, {}, function(err, game) {
      if (game) {
        game.started = true;
        game.area_edges = [{lat: 38.704499-0.001600, lon: -9.178818-0.001600},
          {lat: 38.704499-0.001600, lon: -9.175131-0.001600},
          {lat: 38.702620-0.001600, lon: -9.175131-0.001600},
          {lat: 38.702620-0.001600, lon: -9.178818-0.001600}];
        newRound(game);
        game.save(function (err) {})
      }
    });
  });

  channel.subscribe("new-ball-dir", function(message) {
    console.log('ball changed direction');
    var data = JSON.parse(message.data);
    var name = data.name;
    var pos = {lat: data.lat, lon: data.lon};
    var dir = {lat: data.lat_dir, lon: data.lon_dir};
    Game.findOne({}, null, {}, function(err, game) {
      if (game){
        game.last_play.player = name;
        game.last_play.position = pos;
        game.ball_direction = dir;
        game.save(function (err) {
          if (err) {
            console.log(err);
          } else {
            console.log("direction changed");
          }
        });
      }
    });
  });

  //Ticks broadcast stuff
  var i = setInterval(function(){
    Game.findOne({}, null, {}, function(err, game) {
      if(game){
        if(game.started){
          var outside = outside(game);
          if(outside != "inside") {
            newRound(game);
            if (game.last_play && validPoint(game, outside)) {
              game.players.forEach(function(entry) {
                if(entry.name === game.last_play.player) {
                  entry.points += 1;
                  if (entry.points >= 5) {
                    console.log("Game Over !");
                  }
                }
              });
            }
          }
          game.ball.position.lat += game.ball.direction.lat;
          game.ball.position.lon += game.ball.direction.lon;
          game.save(function (err) {})
        }
        channel.publish('locations', {ball: game.ball.position, players:game.players });
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

function outside(game) {
  if (game.ball.position.lat > game.area_edges[0].lat) return "left";
  if (game.ball.position.lat < game.area_edges[2].lat) return "right";
  if (game.ball.position.lon < game.area_edges[0].lon) return "top";
  if (game.ball.position.lon > game.area_edges[2].lon) return "bot";
  return "inside";
}

function newRound(game) {
  // Ball position
  game.ball.position.lat = (game.area_edges[0].lat + game.area_edges[2].lat) / 2;
  game.ball.position.lon = (game.area_edges[0].lon + game.area_edges[2].lon) / 2;

  // Ball direction
  game.ball.direction.lat = ((Math.floor(Math.random() * (10 + 10 + 1)) -10) * 0.000005).toFixed(6);
  game.ball.direction.lon = ((Math.floor(Math.random() * (10 + 10 + 1)) -10) * 0.000005).toFixed(6);
}

function validPoint(game, outside) {
  var mid_lat = (game.area_edges[0].lat + game.area_edges[2].lat) / 2;
  var mid_lon = (game.area_edges[0].lon + game.area_edges[2].lon) / 2;
  if (outside === "left" && game.last_play.position.lat < mid_lat) return true;
  if (outside === "right" && game.last_play.position.lat > mid_lat) return true;
  if (outside === "top" && game.last_play.position.lon > mid_lon) return true;
  if (outside === "bot" && game.last_play.position.lon < mid_lon) return true;
  return false;
}