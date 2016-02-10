'use strict';
var crypto = require('crypto');
var cradle = require('cradle');
var pr = require('promise-ring');

var connection = new cradle.Connection();
var treasonDb = pr.wrapAll(connection.database('treason_db'));

var ready = Promise.all([
    treasonDb.exists().then(function (exists) {
        if (!exists) {
            return treasonDb.create();
        }
    })
]).then(function() {
    debug('All databases initialized');
}).then(function() {
    debug('Initializing views');
    treasonDb.save('_design/games', {
        all_games: {
            map: function (document) {
                if (document.players && document.playerRank) {
                    emit(null, document);
                }
            }
        },
        player_wins: {
            map: function (document) {
                if (document.players && document.playerRank) {
                    emit(document.playerRank[0], document);
                }
            }
        },
        all_players: {
            map: function (document) {
                //This sucks, fix it, so easy to get collisions
                if (document.name) {
                    emit(null, document);
                }
            }
        }
    });
    debug('Finished initializing views, databases ready');
}).catch(function(error) {
    debug('Failed to initialize database(s)');
    debug(error);
});

var register = function (id, name) {
    return ready.then(function() {
        debug('Player ' + name + ', trying to register with id ' + id);

        return treasonDb.get(id)
            .then(function (result) {
                if (result.name != name) {
                    debug('Updating name of player ' + result.name + ' to ' + name);
                    treasonDb.merge(id, {
                        name: name
                    }).then(function (result) {
                        debug('Updated name of playerId ' + id + ' to ' + name);
                    }).catch(function (error) {
                        debug('Failed to update player.');
                        debug(error);
                    });
                }
                debug('Existing player ' + name + ' logged in with id ' + id);
            })
            .catch(function (error) {
                //failed to find the player, recreate with new id
                debug('Id ' + id + ' not recognised, recreating');
                id = crypto.randomBytes(32).toString('hex');

                debug('Saving new id ' + id + ' for player ' + name);
                return treasonDb.save(id, {
                    name: name
                }).then(function (result) {
                    debug('Allocated new id ' + id + ' to player: ' + name);
                }).catch(function (error) {
                    debug('Failed to save player');
                    debug(error);
                });
            })
            .then(function() {
                return id;
            });
    });
};

/**
 * Captures statistics about each game.
 * PlayerRank is ordered by the first outgoing player being last in the array, with the winner first and no disconnects.
 * @type {{players: number, onlyHumans: boolean, playerRank: Array, bluffs: number, challenges: number, moves: number}}
 */
var constructGameStats = function() {
    return {
        players: 0,
        onlyHumans: true,
        playerRank: [],
        bluffs: 0,
        challenges: 0,
        moves: 0
    };
};

var recordGameData = function (gameData) {
    return ready.then(function () {
        return treasonDb.save(gameData).then(function (result) {
            debug('saved game data');
        }).catch(function (error) {
            debug('failed to save game data');
            debug(error);
        });
    });
};

var getPlayerWins = function (playerId, options) {
    return ready.then(function () {
        return treasonDb.view('games/player_wins', {key: playerId} ).then(function (result) {
            var wins = 0;
            result.forEach(function (row) {
                if (options) {
                    if (options.humanOnly && row.onlyHumans) {
                        wins++;
                    } else if (!options.humanOnly) {
                        wins++;
                    }
                } else {
                    wins++;
                }
            });
            return wins;
        }).catch(function (error) {
            debug('failed to look up player wins');
            debug(error);
        });
    });
};

var getAllPlayers = function (options) {
    return ready.then(function () {
        return treasonDb.view('games/all_players').then(function (result) {
            var players = [];
            result.forEach(function (row) {
                players.push({
                    playerName: row.name,
                    playerId: row._id
                })
            });
            return players;
        }).catch(function (error) {
            debug('failed to look up all players');
            debug(error);
        });
    });
};

var buildPlayerWin = function (player) {
    return ready.then(function () {
        return getPlayerWins(player.playerId).then(function (wins) {
            return {
                playerName: player.playerName,
                wins: wins
            };
        });
    });
};

var getPlayerRankings = function (options) {
    return ready.then(function () {
        return getAllPlayers().then(function (players) {
            var stats = [];
            return Promise.all(players.map(buildPlayerWin)).then(function (playerStats) {
                stats.push(playerStats);
                return stats;
            });
        });
    });
};

module.exports = {
    register: register,
    constructGameStats: constructGameStats,
    recordGameData: recordGameData,
    getPlayerWins: getPlayerWins,
    getAllPlayers: getAllPlayers,
    getPlayerRankings: getPlayerRankings
};

function debug(message) {
    console.log(message);
}