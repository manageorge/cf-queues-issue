import {
  SingleElimination,
  DoubleElimination,
  RoundRobin,
  Stepladder,
  Swiss
} from 'tournament-pairings';
import axios from 'axios';

export function reverseString(str) {
  //reverses a string
  return (str === '') ? '' : reverseString(str.substr(1)) + str.charAt(0);
}

export async function pair(input) {
  try {
    //unpack input
    var env = input.env;
    var tournament_id = input.tournament_id;
    //check if tournament ongoing and closed
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT * FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'].length == 0) {
      return 'Error: No ongoing tournament in this channel.';
    }
    if (ongoing_tournaments_fetch['results'][0]['open'] == 'true') {
      return 'Error: Tournament registration is still open.';
    }
    var round = Number(ongoing_tournaments_fetch['results'][0]['round']);
    if (!round) {
      round = 0;
    }
    //check for sufficient players to pair
    var players_check = await env.DB.prepare('SELECT player_id FROM players WHERE tournament_id = ? EXCEPT SELECT player_id FROM players WHERE tournament_id = ? AND dropped = ?').bind(tournament_id, tournament_id, 'true').all();
    if (players_check['results'].length < 2) {
      return 'Error: Too few players to pair.';
    }
    //check for existing pairings
    var pairings = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ?').bind(tournament_id).all();
    if (pairings['results'].length > 0) {
      var pairings_exist = true;
    } else {
      var pairings_exist = false;
    }
    //if (round == 0 || all reports recieved), pair new round, else return pairings or 'no pairings exist'
    var report_null_p1 = await env.DB.prepare('SELECT player_one FROM pairings WHERE tournament_id = ? AND round = ? AND record_p1 IS NULL').bind(tournament_id, round).all();
    var report_null_p2 = await env.DB.prepare('SELECT player_two FROM pairings WHERE tournament_id = ? AND round = ? AND record_p2 IS NULL').bind(tournament_id, round).all();
    if (round == 0 || (report_null_p1['results'].length == 0 && report_null_p2['results'].length == 0)) {
      //record points in players
      if (round > 0) {
        //get players and current score
        var pre_score_fetch = await env.DB.prepare('SELECT player_id, m_score, mwp, g_score, gwp, played_ids, wins, losses, draws FROM players WHERE tournament_id = ?').bind(tournament_id).all();
        var pre_score = {};
        var m_records = {};
        var g_records = {};
        var played_dict = {};
        var old_mwp = {};
        var old_gwp = {};
        var records = {};
        for (let i = 0; i < pre_score_fetch['results'].length; i++) {
          if (pre_score_fetch['results'][i]['played_ids'] && pre_score_fetch['results'][i]['played_ids'] != '') {
            var played_ids = pre_score_fetch['results'][i]['played_ids'].split(', ');
          } else {
            var played_ids = '';
          }
          m_records[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['m_score'];
          old_mwp[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['mwp'];
          g_records[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['g_score'];
          old_gwp[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['gwp'];
          played_dict[pre_score_fetch['results'][i]['player_id']] = played_ids;
          records[pre_score_fetch['results'][i]['player_id']] = {wins: pre_score_fetch['results'][i]['wins'], losses: pre_score_fetch['results'][i]['losses'], draws: pre_score_fetch['results'][i]['draws']}
        }
        //get round results for each player
        var round_results_fetch = await env.DB.prepare('SELECT player_one, record_p1, player_two, record_p2 FROM pairings WHERE tournament_id = ? AND round = ?').bind(tournament_id, round).all();
        var round_results = {};
        for (let i = 0; i < round_results_fetch['results'].length; i++) {
          round_results[round_results_fetch['results'][i]['player_one']] = round_results_fetch['results'][i]['record_p1'];
          round_results[round_results_fetch['results'][i]['player_two']] = round_results_fetch['results'][i]['record_p2'];
        }
        //update scores in players table
        for (let player in round_results) {
          //skip if player is 'bye'
          if (round_results[player] == 'bye') {
            continue;
          }
          var w_l_d = round_results[player].split('-');
          var round_wins = Number(w_l_d[0]);
          var round_losses = Number(w_l_d[1]);
          if (!m_records[player]) {
            var player_m_record = 0;
          } else {
            var player_m_record = Number(m_records[player]);
          }
          if (!g_records[player]) {
            var player_g_record = 0;
          } else {
            var player_g_record = Number(m_records[player]);
          }
          var round_ties = 0;
          if (w_l_d.length == 3) {
            round_ties = Number(w_l_d[2]);
          }
          var new_g_record = player_g_record + (round_wins * 3) + round_ties;
          //setup new m_record
          if (round_wins > round_losses) {
            //player won match
            var new_m_record = player_m_record + 3;
            await env.DB.prepare('UPDATE players SET wins = ? WHERE player_id = ? AND tournament_id = ?').bind(records[player]['wins'] + 1, player, tournament_id).run();
          } else if (round_wins == round_losses) {
            //player tied match
            var new_m_record = player_m_record + 1;
            await env.DB.prepare('UPDATE players SET draws = ? WHERE player_id = ? AND tournament_id = ?').bind(records[player]['draws'] + 1, player, tournament_id).run();
          } else {
            //if player lost match
            var new_m_record = player_m_record;
            await env.DB.prepare('UPDATE players SET losses = ? WHERE player_id = ? AND tournament_id = ?').bind(records[player]['losses'] + 1, player, tournament_id).run();
          }
          var new_mwp = (new_m_record / (played_dict[player].length * 3)).toFixed(4);
          var new_gwp = (new_g_record / (played_dict[player].length * 3)).toFixed(4);
          await env.DB.prepare('UPDATE players SET m_score = ?, mwp = ?, g_score = ?, gwp = ? WHERE player_id = ? AND tournament_id = ?').bind(new_m_record, new_mwp, new_g_record, new_gwp, player, tournament_id).run();
        }
      }
      //perform new pairings, increment round
      //retrieve player data (need to pull player data again to have updated points... could do this by making more vars but easier to pull again)
      var players_fetch = await env.DB.prepare('SELECT player_id, played_ids, m_score, received_bye FROM players WHERE tournament_id = ? EXCEPT SELECT player_id, played_ids, m_score, received_bye FROM players WHERE tournament_id = ? AND dropped = ?').bind(tournament_id, tournament_id, 'true').all();
      //process player data
      var players = [];
      var avoid_dict = {};
      for (let i = 0; i < players_fetch['results'].length; i++) {
        if (players_fetch['results'][i]['received_bye'] == 'true') {
          var player_received_bye = true;
        } else {
          var player_received_bye = false;
        }
        if (players_fetch['results'][i]['played_ids']) {
          var player_avoid = players_fetch['results'][i]['played_ids'].split(', ');
        } else {
          var player_avoid = [];
        }
        //had an error here due to id (etc.) being read as vars
        //think making them strings works
        var player = {
          'id': players_fetch['results'][i]['player_id'],
          'score': players_fetch['results'][i]['m_score'],
          'receivedBye': player_received_bye,
          'avoid': player_avoid,
        };
        //add entry to avoid_dict for later
        avoid_dict[players_fetch['results'][i]['player_id']] = player_avoid;
        players.push(player);
      }
      //create other inputs for Swiss()
      round += 1;
      try {
        var swiss_pairings = Swiss(players, round);  
      } catch (error) {
        console.log(error)
        //revert changes
        for (let player in pre_score) {
          await env.DB.prepare('UPDATE players SET m_score = ?, mwp = ?, g_score = ?, gwp = ? WHERE player_id = ? AND tournament_id = ?').bind(m_records[player], old_mwp[player], g_records[player], old_gwp[player], player, tournament_id).run();
        }
        return 'Error: Unable to generate further pairings.';
      }
      //place Swiss() output into pairings table
      for (let i = 0; i < swiss_pairings.length; i++) {
        var player_one = swiss_pairings[i]['player1'];
        if (!swiss_pairings[i]['player2']) {
          var player_two = 'bye';
        } else {
          var player_two = swiss_pairings[i]['player2'];
        }
        await env.DB.prepare('INSERT INTO pairings (tournament_id, round, player_one, player_two) VALUES (?, ?, ?, ?)').bind(tournament_id, round, player_one, player_two).run();
        //if player has bye, update recieved_bye in players and set pairings record entries to 2-0
        if (player_two == 'bye') {
          await env.DB.prepare('UPDATE players SET received_bye = ? WHERE player_id = ? AND tournament_id = ?').bind('true', player_one, tournament_id).run();
          await env.DB.prepare('UPDATE pairings SET record_p1 = ?, record_p2 = ? WHERE tournament_id = ? AND round = ? AND player_one = ?').bind('2-0', 'bye', tournament_id, round, player_one).run();
          continue;
        }
        //if match does not include bye, add players to eachother's played_ids
        //reusing players[player] from earlier         
        var spacer = '';
        if (avoid_dict[player_one].length > 0) {
          spacer = ', ';
          var player_one_updated_avoid = avoid_dict[player_one].join(', ');
        } else {
          var player_one_updated_avoid = '';
        }
        player_one_updated_avoid = player_one_updated_avoid.concat(spacer, player_two);
        await env.DB.prepare('UPDATE players SET played_ids = ? WHERE player_id = ? AND tournament_id = ?').bind(player_one_updated_avoid, player_one, tournament_id).run();
        var spacer = '';
        if (avoid_dict[player_two].length > 0) {
          spacer = ', ';
          var player_two_updated_avoid = avoid_dict[player_two].join(', ');
        } else {
          var player_two_updated_avoid = '';
        }
        player_two_updated_avoid = player_two_updated_avoid.concat(spacer, player_one);
        await env.DB.prepare('UPDATE players SET played_ids = ? WHERE player_id = ? AND tournament_id = ?').bind(player_two_updated_avoid, player_two, tournament_id).run();
      }
      var pairings_exist = true;
      await env.DB.prepare('UPDATE ongoing_tournaments SET round = ? WHERE id = ?').bind(round, tournament_id).run();
    }
    var pairings_text = `**Round ${round} pairings:**`;
    //if (all reports not recived and round > 0), return exisiting pairings or 'no pairings exist'
    if (pairings_exist) {
      //make pairings text
      //grab round's pairings
      var round_pairings_fetch = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ? and round = ?').bind(tournament_id, round).all();
      var round_pairings = [];
      for (let i = 0; i < round_pairings_fetch['results'].length; i++) {
        var pair = [round_pairings_fetch['results'][i]['player_one'], round_pairings_fetch['results'][i]['player_two']];
        round_pairings.push(pair);
      }
      //grab and process player data
      var decks_fetch = await env.DB.prepare('SELECT player_id, deck_name, deck_link, name, pronouns FROM players WHERE tournament_id = ?').bind(tournament_id).all();
      var decks_dict = {};
      for (let i = 0; i < decks_fetch['results'].length; i++) {
        decks_dict[decks_fetch['results'][i]['player_id']] = [decks_fetch['results'][i]['deck_name'], decks_fetch['results'][i]['deck_link'], decks_fetch['results'][i]['name'], decks_fetch['results'][i]['pronouns']];
      }
      //actually make the text now
      var bye_text = ''
      for (let pair in round_pairings) {
        var p1 = round_pairings[pair][0];
        var p2 = round_pairings[pair][1];
        var p1_name = decks_dict[p1][2];
        var format_p1_l = '';
        var format_p1_r = '';
        if (p1_name) {
          var format_p1_l = ' (';
          var format_p1_r = ')';
        }
        if (p1_name && decks_dict[p1][3]) {
          p1_name += ` (${decks_dict[p1][3]}`;
        } else if (decks_dict[p1][3]) {
          format_p1_r += ` (${decks_dict[p1][3]}`;
        }
        if (p2 == 'bye') {
          bye_text += `\n\n${p1_name}${format_p1_l}<@${p1}>${format_p1_r} has the bye this round!`;
          continue;
        }
        var format_p2_l = '';
        var format_p2_r = '';
        var p2_name = decks_dict[p2][2];
        if (p2_name) {
          var format_p2_l = ' (';
          var format_p2_r = ')';
        }
        if (p2_name && decks_dict[p2][3]) {
          p2_name += ` (${decks_dict[p2][3]}`;
        } else if (decks_dict[p2][3]) {
          format_p2_r += ` (${decks_dict[p2][3]}`;
        }
        if (ongoing_tournaments_fetch['results'][0]['decklist_pub'] == 'true') {
          var p1_deck_name = decks_dict[p1][0];
          var p1_deck_link = decks_dict[p1][1];
          var p2_deck_name = decks_dict[p2][0];
          var p2_deck_link = decks_dict[p2][1];
          pairings_text += `\n\n${p1_name}${format_p1_l}<@${p1}>${format_p1_r} on [${p1_deck_name}](<${p1_deck_link}>) vs ${p2_name}${format_p2_l}<@${p2}>${format_p2_r} on [${p2_deck_name}](<${p2_deck_link}>)`;
        } else {
          pairings_text += `\n\n${p1_name}${format_p1_l}<@${p1}>${format_p1_r} vs ${p2_name}${format_p2_l}<@${p2}>${format_p2_r}`;
        }
      }
      pairings_text += bye_text;
      //output
      return pairings_text;
    }
    return 'Error: No pairings exist.';
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in pair function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function process_open_modal(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    var guildUrl = `https://discord.com/api/v10/guilds/${interaction.guild_id}`
    var response = await fetch(guildUrl, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      }, 
      method:'GET',
    });
    var guild_data = await response.json();
    var tournament_id = interaction.guild_id + interaction.channel_id;
    if (interaction.data['components'][0]['components'][0]['value']) {
      var t_name = interaction.data['components'][0]['components'][0]['value'];
    } else {
      var t_name = '';
    }
    if (interaction.data['components'][1]['components'][0]['value']) {
      var to_moxfield = interaction.data['components'][1]['components'][0]['value'];
    } else {
      var to_moxfield = '';
    }
    //establish tournament default settings
    var t_defaults = {};
    t_defaults['id'] = tournament_id;
    t_defaults['server_name'] = guild_data['name'];
    var channel_url = `https://discord.com/api/v10/channels/${interaction.channel_id}`
    var response = await fetch(channel_url, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      }, 
      method:'GET',
    });
    var channel_data = await response.json();
    t_defaults['channel_name'] = channel_data['name'];
    t_defaults['decklist_req'] = 'false';
    t_defaults['decklist_pub'] = 'false';
    t_defaults['swaps'] = '0';
    t_defaults['swaps_pub'] = 'false';
    t_defaults['elim_style'] = 'swiss';
    t_defaults['t_format'] = 'unknown';
    //if tournament has an entry in tournament_defaults, use those values
    var check_defaults = await env.DB.prepare("SELECT * FROM tournament_defaults WHERE id = ?").bind(tournament_id).all();
    if (check_defaults['results'].length > 0) {
      t_defaults['decklist_req'] = check_defaults['results'][0]['decklist_req'];
      t_defaults['decklist_pub'] = check_defaults['results'][0]['decklist_pub'];
      t_defaults['swaps'] = check_defaults['results'][0]['swaps'];
      t_defaults['swaps_pub'] = check_defaults['results'][0]['swaps_pub'];
      t_defaults['elim_style'] = check_defaults['results'][0]['elim_style'];
      t_defaults['t_format'] = check_defaults['results'][0]['t_format'];
    } else {
      //if no entry in tournament_defaults, make one
      await env.DB.prepare('INSERT INTO tournament_defaults (id, server_name, channel_name, decklist_req, decklist_pub, swaps, swaps_pub, elim_style, t_format, t_name, to_moxfield) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(t_defaults['id'], t_defaults['server_name'], t_defaults['channel_name'], t_defaults['decklist_req'], t_defaults['decklist_pub'], t_defaults['swaps'], t_defaults['swaps_pub'], t_defaults['elim_style'], t_defaults['t_format'], t_name, to_moxfield).run();
    }
    //make new tournament entry in ongoing_tournaments table
    await env.DB.prepare('INSERT INTO ongoing_tournaments (id, open, round, decklist_req, decklist_pub, swaps, swaps_pub, elim_style, t_format, t_name, to_moxfield) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(t_defaults['id'], 'true', 0, t_defaults['decklist_req'], t_defaults['decklist_pub'], t_defaults['swaps'], t_defaults['swaps_pub'], t_defaults['elim_style'], t_defaults['t_format'], t_name, to_moxfield).run();
    //announce tournament
    if (t_defaults['decklist_req'] == 'true') {
      if (t_defaults['decklist_pub'] == 'true') {
        var announceDeck = ' Decklists are required and public.';
      } else{
        var announceDeck = ' Decklists are required.';
      }
    } else {
      var announceDeck = '';
    }
    if (t_defaults['swaps'] > 0) {
      var swapCountStr = t_defaults['swaps'].toString();
      if (t_defaults['swaps_pub'] == 'true') {
        var announceSwaps = ` ${swapCountStr} swaps are allowed per round. Swaps are public.`;
      } else {
        var announceSwaps = ` ${swapCountStr} swaps are allowed per round. Swaps are not public until deck changes are made.`;
      }
    } else {
      var announceSwaps = ``;
    }
    if (t_name) {
      var name_placeholder = `the ${t_name}`;
    } else {
      var name_placeholder = 'a';
    }
    return `<@${interaction.member.user.id}> has opened ${name_placeholder} tournament in this channel. Use "/register" to join!${announceDeck}${announceSwaps} Rounds are ${t_defaults['elim_style']}.`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in open function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function close(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    //close registration
    await env.DB.prepare('UPDATE ongoing_tournaments SET open = ? WHERE id = ?').bind('false', tournament_id).run();
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT t_name, to_moxfield FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'][0]['t_name']) {
      var name_placeholder = ` for the ${ongoing_tournaments_fetch['results'][0]['t_name']} tournament.`;
    } else {
      var name_placeholder = `.`;
    }
    if (ongoing_tournaments_fetch['results'][0]['to_moxfield']) {
      var queue = await env.TBQ.send({
        f_call: 'share',
        interaction: interaction,
        to_moxfield: ongoing_tournaments_fetch['results'][0]['to_moxfield']
      });
    }
    return `<@${interaction.member.user.id}> closed tournament registration${name_placeholder}`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in close function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function pairing(input) {
  try {
    //process inputs
    var env = input.env;
    var interaction = input.interaction;
    var tournament_id = interaction.guild_id + interaction.channel_id;
    //tournament check
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT * FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'].length == 0) {
      return 'Error: No ongoing tournament in this channel.';
    }
    //establish round
    var round = Number(ongoing_tournaments_fetch['results'][0]['round']);
    if (!round) {
      return `Error: No pairings found.`;
    }
    //check for user in pairings
    var pairings_fetch = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(tournament_id, interaction.member.user.id, interaction.member.user.id, round).all();
    if (pairings_fetch['results'].length == 0) {
      return `Error: You are not included in current pairings.`;
    }
    //make pairing text
    var pair_text = ``;
    //grab and process player info
    var p1 = pairings_fetch['results'][0]['player_one'];
    var p2 = pairings_fetch['results'][0]['player_two'];
    var p1_deck_fetch = await env.DB.prepare('SELECT deck_name, deck_link, name, pronouns FROM players WHERE tournament_id = ? AND player_id = ?').bind(tournament_id, p1).all();
    var p2_deck_fetch = await env.DB.prepare('SELECT deck_name, deck_link, name, pronouns FROM players WHERE tournament_id = ? AND player_id = ?').bind(tournament_id, p2).all();
    var p1_name = p1_deck_fetch['results'][0]['name'];
    var format_p1_l = '';
    var format_p1_r = ''; 
    if (p1_name) {
      var format_p1_l = ' (';
      var format_p1_r = ')';
    }
    if (p1_name && p1_deck_fetch['results'][0]['pronouns']) {
      p1_name += ` (${p1_deck_fetch['results'][0]['pronouns']})`;
    } else if (p1_deck_fetch['results'][0]['pronouns']) {
      format_p1_r += ` (${p1_deck_fetch['results'][0]['pronouns']})`;
    }
    var p2_name = p2_deck_fetch['results'][0]['name'];
    var format_p2_l = '';
    var format_p2_r = '';
    if (p2_name) {
      var format_p2_l = ' (';
      var format_p2_r = ')';
    }
    if (p2_name && p2_deck_fetch['results'][0]['pronouns']) {
      p2_name += ` (${p2_deck_fetch['results'][0]['pronouns']})`;
    } else if (p2_deck_fetch['results'][0]['pronouns']) {
      format_p2_r += ` (${p2_deck_fetch['results'][0]['pronouns']})`;
    }
    if (ongoing_tournaments_fetch['results'][0]['decklist_pub'] == 'true') {
      var p1_deck_name = p1_deck_fetch['results'][0]['deck_name'];
      var p2_deck_name = p2_deck_fetch['results'][0]['deck_name'];
      var p1_deck_link = p1_deck_fetch['results'][0]['deck_link'];
      var p2_deck_link = p2_deck_fetch['results'][0]['deck_link'];
      pair_text += `${p1_name}${format_p1_l}<@${p1}>${format_p1_r} on [${p1_deck_name}](<${p1_deck_link}>) vs ${p2_name}${format_p2_l}<@${p2}>${format_p2_r} on [${p2_deck_name}](<${p2_deck_link}>)`;
    } else {
      pair_text += `${p1_name}${format_p1_l}<@${p1}>${format_p1_r} vs ${p2_name}${format_p2_l}<@${p2}>${format_p2_r}`
    }
    //output
    return pair_text;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in pairing function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function process_report_modals(input) {
  try {
    //process inputs
    var env = input.env;
    var interaction = input.interaction;
    var tournament_id = interaction.guild_id + interaction.channel_id;
    var report = interaction.data['components'][0]['components'][0]['value'] + '-' + interaction.data['components'][1]['components'][0]['value'];
    if (interaction.data['components'][2]['components'][0]['value'] && (interaction.data['components'][2]['components'][0]['value'] != '0' &&interaction.data['components'][2]['components'][0]['value'] != 0)) {
      report += '-' + interaction.data['components'][2]['components'][0]['value'];
    }
    if (input.target) {
      var target_id = input.target;
    } else {
      var target_id = interaction.member.user.id;
    }
    //check if tournament ongoing and closed
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT open, round, decklist_pub FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'].length == 0) {
      return 'Error: No ongoing tournament in this channel.';
    }
    if (ongoing_tournaments_fetch['results'][0]['open'] == 'open') {
      return 'Error: Tournament registration is still open.';
    }
    var round = ongoing_tournaments_fetch['results'][0]['round'];
    if (!round || round == 0 || round == '0') {
      return 'Error: Rounds have not started.';
    }
    //if opponent has reported, check inputs against opponent's report
    var pairings_fetch = await env.DB.prepare('SELECT player_one, player_two, record_p1, record_p2 FROM pairings WHERE tournament_id = ? AND round = ? AND (player_one = ? OR player_two = ?)').bind(tournament_id, round, target_id, target_id).all();
    if (pairings_fetch['results'][0]['player_one'] != target_id) {
      var target_is_p1 = false;
    } else {
      var target_is_p1 = true;
    }
    if ((target_is_p1 && pairings_fetch['results'][0]['record_p2']) || (!target_is_p1 && pairings_fetch['results'][0]['record_p1'])) {
      if (target_is_p1) {
        var pairings = pairings_fetch['results'][0]['record_p2'];
      } else {
        var pairings = pairings_fetch['results'][0]['record_p1'];
      }
      if (pairings.length == 3) {
        var test_string = reverseString(pairings);
      } else if (pairings.length == 5) {
        var test_string = reverseString(pairings.substr(0,3)) + pairings.substr(3);
      } else {
        return `Error: Error in recorded match record for opponent. Your submission was not recorded. Please have them re-submit or TO override your match records before resubmitting your record.`;
      }
      if (report != test_string) {
        return `Error: Reported match record does not match opponent's reported match record. Your submission was not recorded. If this was an error on opponent's part, please have them resubmit or TO override your match records before resubmitting your record.`;
      }
    }
    //record report in pairings
    if (target_is_p1) {
      await env.DB.prepare('UPDATE pairings SET record_p1 = ? WHERE tournament_id = ? AND round = ? AND (player_one = ? OR player_two = ?)').bind(report, tournament_id, round, target_id, target_id).run();
    } else {
      await env.DB.prepare('UPDATE pairings SET record_p2 = ? WHERE tournament_id = ? AND round = ? AND (player_one = ? OR player_two = ?)').bind(report, tournament_id, round, target_id, target_id).run();
    }
    //output
    if (target_id != interaction.member.user.id) {
      return `<@${interaction.member.user.id}> reported match result: ${report} for <@${target_id}>`;
    }
    return `<@${interaction.member.user.id}> reported match result: ${report}`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in process_report_modals function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function missing_results(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;    
    //check if tournament ongoing and closed
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT open, round, decklist_pub FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'].length == 0) {
      return 'Error: No ongoing tournament in this channel.';
    }
    if (ongoing_tournaments_fetch['results'][0]['open'] == 'open') {
      return 'Error: Tournament registration is still open.';
    }
    var round = ongoing_tournaments_fetch['results'][0]['round'];
    if (!round || round == 0 || round == '0') {
      return 'Error: Rounds have not started.';
    }
    //check for existing pairings
    var pairings_fetch = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ?').bind(tournament_id).all();
    if (pairings_fetch['results'].length == 0) {
      return'Error: No pairings found.';
    } 
    //add player from each NULL record in pairings to array
    //it's easier to have two SELECT statements than to parse this out of one SELECT statement
    var p1_nulls = await env.DB.prepare('SELECT player_one FROM pairings WHERE tournament_id = ? AND round = ? AND record_p1 IS NULL').bind(tournament_id, round).run();
    var p2_nulls = await env.DB.prepare('SELECT player_two FROM pairings WHERE tournament_id = ? AND round = ? AND record_p2 IS NULL').bind(tournament_id, round).run();
    if (p1_nulls['results'].length == 0 && p2_nulls['results'].length == 0) {
      return 'All players have reported for the current round!';
    }
    var need_players = [];
    for (let i = 0; i < p1_nulls['results'].length; i++) {
      need_players.push(p1_nulls['results'][i]['player_one']);
    }
    for (let i = 0; i < p2_nulls['results'].length; i++) {
      need_players.push(p2_nulls['results'][i]['player_two']);
    }
    var output = `Missing match reports from:\n`;
    for (let i = 0; i < need_players.length; i++) {
      output += `\n<@${need_players[i]}>`
    }
    return output;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in missing_results function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function standings(input) {
  try {
    //breakout input
    var env = input.env;
    var interaction = input.interaction;
    var tournament_id = interaction.guild_id + interaction.channel_id;
    //check if tournament ongoing
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT * FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'].length == 0) {
      return 'Error: No ongoing tournament in this channel.';
    }
    if (ongoing_tournaments_fetch['results'][0]['open'] == 'true') {
      return 'Error: Tournament registration is still open.';
    }
    var round = ongoing_tournaments_fetch['results'][0]['round'];
    var elim_style = ongoing_tournaments_fetch['results'][0]['elim_style'];
    var t_name = ongoing_tournaments_fetch['results'][0]['t_name'];
    //prepare standings output
    var standings_text = '';
    switch (elim_style.toLowerCase()) {
      case 'swiss': {
        //grab player data
        var player_data_fetch = await env.DB.prepare('SELECT player_id, deck_name, deck_link, name, pronouns, m_score, mwp, g_score, gwp, played_ids, wins, losses, draws FROM players WHERE tournament_id = ? ORDER BY m_score').bind(tournament_id).run();
        if (player_data_fetch['results'].length == 0) {
          return 'Error: No players have registered for the tournament.';
        }
        //process player data
        var player_data = {};
        for (let i = 0; i < player_data_fetch['results'].length; i++) {
          if (!player_data_fetch['results'][i]['played_ids']) {
            var played_ids = '';
          } else {
            var played_ids = player_data_fetch['results'][i]['played_ids'].split(', ');
          }
          var player_wins = player_data_fetch['results'][i]['wins'];
          if (!player_wins) {
            player_wins = '0';
          }
          var player_losses = player_data_fetch['results'][i]['losses'];
          if (!player_losses) {
            player_losses = '0';
          }
          var player = {
            'name': player_data_fetch['results'][i]['name'],
            'player_id': player_data_fetch['results'][i]['player_id'],
            'deck_name': player_data_fetch['results'][i]['deck_name'],
            'deck_link': player_data_fetch['results'][i]['deck_link'],
            'm_score': player_data_fetch['results'][i]['m_score'],
            'mwp': player_data_fetch['results'][i]['mwp'],
            'g_score': player_data_fetch['results'][i]['g_score'],
            'gwp': player_data_fetch['results'][i]['gwp'],
            'played_ids': played_ids,
            'record': player_wins + '-' + player_losses,
            'pronouns': player_data_fetch['results'][i]['pronouns']
          };
          if (player_data_fetch['results'][i]['draws']) {
            player['record'] = player['record'] + '-' + player_data_fetch['results'][i]['draws'];
          }
          player_data[player_data_fetch['results'][i]['player_id']] = player;
        }
        //calculate omwp and ogwp, make new player data array for sorting (there has to be a better way to do this)
        var player_array = [];
        for (let player in player_data) {
          var cum_omwp = 0;
          var cum_ogwp = 0;
          for (let opponent in player_data[player]['played_ids']) {
            var opponent_id = player_data[player]['played_ids'][opponent];
            cum_omwp += Math.max(player_data[opponent_id]['mwp'], 0.33);
            cum_ogwp += Math.max(player_data[opponent_id]['gwp'], 0.33);
          }
          player_data[player]['omwp'] = cum_omwp / player_data[player]['played_ids'].length;
          player_data[player]['ogwp'] = cum_ogwp / player_data[player]['played_ids'].length;
          var data = {
            'name': player_data[player]['name'],
            'player_id': player_data[player]['player_id'],
            'deck_name': player_data[player]['deck_name'],
            'deck_link': player_data[player]['deck_link'],
            'm_score': player_data[player]['m_score'],
            'mwp': player_data[player]['mwp'],
            'g_score': player_data[player]['g_score'],
            'gwp': player_data[player]['gwp'],
            'played_ids': player_data[player]['played_ids'],
            'omwp': player_data[player]['omwp'],
            'ogwp': player_data[player]['ogwp'],
            'record': player_data[player]['record'],
            'pronouns': player_data[player]['pronouns'],
          };
          player_array.push(data);
        }
        //sort player_array by match score, then omwp, then game score, then ogwp
        player_array.sort(function (a, b) {
          return b.m_score - a.m_score || b.omwp - a.omwp || b.g_score - a.g_score || b.ogwp - a.ogwp;
        });
        //setup other variables
        var last_m_score = 10000;
        var last_omwp = 1;
        var last_g_score = 10000;
        var last_ogwp = 1;
        if (!round) {
          var round = 0;
        }
        standings_text += `**${t_name}, round ${round} standings:**`;
        var placement = 1;
        var players_since_last_placement = 0;
        //make output
        for (let player in player_array) {
          var name = player_array[player]['name'];
          var player_id = player_array[player]['player_id'];
          var deck_name = player_array[player]['deck_name'];
          var m_score = player_array[player]['m_score'];
          var omwp = player_array[player]['omwp'];
          var g_score = player_array[player]['g_score'];
          var ogwp = player_array[player]['ogwp'];
          var record = player_array[player]['record'];
          if (m_score < last_m_score) {
            last_m_score = m_score;
            last_omwp = omwp;
            last_g_score = g_score;
            last_ogwp = ogwp;
            placement += players_since_last_placement;
            players_since_last_placement = 1;
          } else if (omwp < last_omwp){
            last_omwp = omwp;
            last_g_score = 10000;
            last_ogwp = 1;
            placement += players_since_last_placement;
            players_since_last_placement = 1;;
          } else if (g_score < last_g_score) {
            last_g_score = g_score;
            last_ogwp = 1;
            placement += players_since_last_placement;
            players_since_last_placement = 1;
          } else if (ogwp < last_ogwp) {
            last_ogwp = ogwp;
            placement += players_since_last_placement;
            players_since_last_placement = 1;
          } else {
            players_since_last_placement += 1;
          }
          var format_l = '';
          var format_r = '';
          if (name) {
            var format_l = ' (';
            var format_r = ')';
          }
          if (name && player_array[player]['pronouns']) {
            name += ` (${player_array[player]['pronouns']})`;
          } else if (player_array[player]['pronouns']) {
            format_r += ` (${player_array[player]['pronouns']})`;
          }
          if (ongoing_tournaments_fetch['results'][0]['decklist_pub'] == 'true') {
            var deck_link = player_array[player]['deck_link'];
            standings_text += `\n${placement} - ${name}${format_l}<@${player_id}>${format_r} on [${deck_name}](<${deck_link}>) (${record})`;
          } else {
            standings_text += `\n${placement} - ${name}${format_l}<@${player_id}>${format_r} (${record})`;
          }
        }
        break;
      }
      /*
      case 'single elimintation': {
        standings_text += 'Remaining players (unordered):\n';
        var players_fetch = await env.DB.prepare('SELECT * FROM players WHERE tournament_id = ? EXCEPT SELECT * FROM players WHERE tournament_id = ? AND (dropped NOT NULL OR eliminated NOT NULL)').bind(tournament_id, tournament_id).all();
        for (let i = 0; i < players_fetch['results'].length; i++) {
          var name = players_fetch['results'][i]['name'];
          var format_l = '';
          var format_r = '';
          if (name) {
            var format_l = ' (';
            var format_r = ')';
          }
          var player_id = players_fetch['results'][i]['player_id'];
          var deck_name = players_fetch['results'][i]['deck_name'];
          var deck_link = players_fetch['results'][i]['deck_link'];
          if (name && player_data_fetch['results'][i]['pronouns']) {
            name += ` (${player_data_fetch['results'][i]['pronouns']})`
          } else if (player_data_fetch['results'][i]['pronouns']) {
            format_p_r += ` (${player_data_fetch['results'][i]['pronouns']})`
          }
          if (ongoing_tournaments_fetch['results'][0]['decklist_pub'] == 'true') {
            standings_text += `\n${name}${format_l}<@${player_id}>${format_r} on [${deck_name}](<${deck_link}>)`;
          } else {
            standings_text += `\n${name}${format_l}<@${player_id}>${format_r}`;
          }
        }
      }
      */
      default:
        standings_text = 'Unknown elimination style';
    }
    return standings_text;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in standings function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function reopen(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    //reopen registration
    await env.DB.prepare('UPDATE ongoing_tournaments SET open = ? WHERE id = ?').bind('true', tournament_id).run();
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT t_name FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (t_name) {
      var name_placeholder = ` for the ${t_name} tournament.`;
    } else {
      var name_placeholder = `.`;
    }
    return `<@${interaction.member.user.id}> reopened tournament registration${name_placeholder}`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in reopen function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function autofill(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    var fill_to = 16;
    if (interaction.data.options) {
      try {
        fill_to = Number(interaction.data.options[0]['value']);
      } catch (error) {
        return 'Error: Optional input must be a number.';
      }
    }
    //get number of players in tournament
    var player_fetch = await env.DB.prepare('SELECT * FROM players WHERE tournament_id = ?').bind(tournament_id).all();
    //fill to fill_to players
    var deck_link = 'https://www.moxfield.com/decks/-XJ2Vna6BEK_GwVLaGAWqA';
    var added_count = 0;
    for (let i = 0; i < (fill_to - player_fetch['results'].length); i++) {
      var player_id = 'test_player_' + i.toString();
      var deck_name = 'Test Deck ' + i.toString();
      var name = 'Test Player ' + i.toString();
      await env.DB.prepare('INSERT INTO players (player_id, tournament_id, deck_name, deck_link, m_score, g_score, name) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(player_id, tournament_id, deck_name, deck_link, 0, 0, name).run();
      added_count += 1;
    }
    return 'Successfully added ' + added_count.toString() + ' players!';
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in reopen function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function autoreport(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    //check if tournament ongoing and closed
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT open, round FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    if (ongoing_tournaments_fetch['results'].length == 0) {
      return 'Error: No ongoing tournament in this channel.';
    }
    if (ongoing_tournaments_fetch['results'][0]['open'] == 'true') {
      return 'Error: Tournament registration is still open.';
    }
    var round = ongoing_tournaments_fetch['results'][0]['round']
    //check for existing pairings
    var pairings_fetch = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ?').bind(tournament_id).all();
    if (pairings_fetch['results'].length == 0) {
      return 'Error: No pairings found.';
    } 
    //find pairings where neither player has reported, decide random result, record
    var reported_text = `Added reports:\n`;
    var both_nulls_fetch = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ? AND round = ? AND record_p1 IS NULL AND record_p2 IS NULL').bind(tournament_id, round).run();
    for (let i = 0; i < both_nulls_fetch['results'].length; i ++) {
      var random = Math.floor(Math.random() * 8)
      switch(random) {
        case 1: {
          var record_p1 = '2-0';
          var record_p2 = '0-2';
          break;
        }
        case 2: {
          var record_p1 = '0-2';
          var record_p2 = '2-0';
          break;
        }
        case 3: {
          var record_p1 = '2-1';
          var record_p2 = '1-2';
          break;
        }
        case 4: {
          var record_p1 = '1-2';
          var record_p2 = '2-1';
          break;
        }
        case 5: {
          var record_p1 = '2-0-1';
          var record_p2 = '0-2-1';
          break;
        }
        case 6: {
          var record_p1 = '0-2-1';
          var record_p2 = '2-0-1';
          break;
        }
        case 7: {
          var record_p1 = '1-1';
          var record_p2 = '1-1';
          break;
        }
        case 8: {
          var record_p1 = '1-1-1';
          var record_p2 = '1-1-1';
          break;
        }
      }
      await env.DB.prepare('UPDATE pairings SET record_p1 = ?, record_p2 = ? WHERE tournament_id = ? AND round = ? AND player_one = ?').bind(record_p1, record_p2, tournament_id, round, both_nulls_fetch['results'][i]['player_one']).run();
      reported_text += `\n<@${both_nulls_fetch['results'][i]['player_one']}>: ${record_p1}\n<@${both_nulls_fetch['results'][i]['player_two']}>: ${record_p2}`;
    }
    //find pairings where one player has reported, copy opponent's report (doing this after reporting for both avoids double counting areas where both are NULL)
    //fetching the reported player's match record to copy over
    var p1_nulls = await env.DB.prepare('SELECT player_one, record_p2 FROM pairings WHERE tournament_id = ? AND round = ? AND record_p1 IS NULL').bind(tournament_id, round).run();
    var p2_nulls = await env.DB.prepare('SELECT player_two, record_p1 FROM pairings WHERE tournament_id = ? AND round = ? AND record_p2 IS NULL').bind(tournament_id, round).run();
    //establish regex and check opponent's record
    var short_regex = /[0-9]+-[0-9]+/i;
    var long_regex = /[0-9]+-[0-9]+-[0-9]+/i;
    for (let i = 0; i <  p1_nulls['results'].length; i++) {
      var opp_rep = p1_nulls['results'][i]['record_p2'];
      var player = p1_nulls['results'][i]['player_one'];
      if (short_regex.test(opp_rep)) {
        var player_record = reverseString(opp_rep);
      } else if (long_regex.test(opp_rep)) {
        var player_record = reverseString(opp_rep.substr(0,3)) + opp_rep.substr(3);
      } else {
        reported_text += `\nError with opponent record for <@${player}>, use TO override to correct.`;
        continue;
      }
      await env.DB.prepare('UPDATE pairings SET record_p1 = ? WHERE tournament_id = ? AND round = ? AND player_one = ?').bind(player_record, tournament_id, round, player).run();
      reported_text += `\n<@${player}: ${player_record}`;
    }
    for (let i = 0; i <  p2_nulls['results'].length; i++) {
      var opp_rep = p2_nulls['results'][i]['record_p1'];
      var player = p2_nulls['results'][i]['player_two'];
      if (short_regex.test(opp_rep)) {
        var player_record = reverseString(opp_rep);
      } else if (long_regex.test(opp_rep)) {
        var player_record = reverseString(opp_rep.substr(0,3)) + opp_rep.substr(3);
      } else {
        reported_text += `\nError with opponent record for <@${player}>, use TO override to correct.`;
        continue;
      }
      await env.DB.prepare('UPDATE pairings SET record_p2 = ? WHERE tournament_id = ? AND round = ? AND player_two = ?').bind(player_record, tournament_id, round, player).run();
      reported_text += `\n<@${player}: ${player_record}`;
    }
    return reported_text;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in reopen function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function process_defaults_modal(input) {
  try{
    var env = input.env;
    var interaction = input.interaction;  
    var tournament_id = interaction.guild_id + interaction.channel_id;
    //process data from setup func (set_defaults_modal)
    if (interaction.data['components'][0]['components'][0]['value'] == 'y') {
      var decklist_req = 'true';
    } else {
      var decklist_req = 'false';
    }
    if (interaction.data['components'][1]['components'][0]['value'] == 'y') {
      var decklist_pub = 'true';
    } else {
      var decklist_pub = 'false';
    }
    var t_format = interaction.data['components'][2]['components'][0]['value'];
    var elim_style = interaction.data['components'][3]['components'][0]['value'];
    //check for existing default data, update if exists, create if not
    var tournament_defaults_fetch = await env.DB.prepare('SELECT * FROM tournament_defaults WHERE id = ?').bind(tournament_id).all();
    if (tournament_defaults_fetch['results'].length > 0) {
      await env.DB.prepare('UPDATE tournament_defaults SET decklist_req = ?, decklist_pub = ?, t_format = ?, elim_style = ? WHERE id = ?').bind(decklist_req, decklist_pub, t_format, elim_style, tournament_id).run();
    } else {
      //pull server (guild) and channel name for tournament_defaults table
      var guildUrl = `https://discord.com/api/v10/guilds/${interaction.guild_id}`
      var response = await fetch(guildUrl, {
        headers: {
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        }, 
        method: 'GET',
      });
      var guild_data = await response.json();
      var server_name = guild_data['name'];
      var channel_url = `https://discord.com/api/v10/channels/${interaction.channel_id}`
      var response = await fetch(channel_url, {
        headers: {
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        }, 
        method:'GET',
      });
      var channel_data = await response.json();
      var channel_name = channel_data['name'];
      //create new tournament_defaults entry for this channel
      await env.DB.prepare('INSERT INTO tournament_defaults (id, server_name, channel_name, decklist_req, decklist_pub, elim_style, t_format) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(tournament_id, server_name, channel_name, decklist_req, decklist_pub, elim_style, t_format).run();
    }
    return `<@${interaction.member.user.id}> updated tournament defaults for this channel (settings for any ongoing tournament were not changed).`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in processing set_defaults_modal.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time_string).run();
    return RETURN_CONTENT;
  }
}

export async function temp_to_check(input) {
  try {
    //process inputs
    var env = input.env;
    var interaction = input.interaction;
    var command = input.command;
    var tournament_id = interaction.guild_id + interaction.channel_id;
    var target_id = interaction.member.user.id;
    //if TO targetting another user, find the data stored in temp_to
    var temp_to_fetch = await env.DB.prepare('SELECT target_id FROM temp_to WHERE to_id = ? AND tournament_id = ? AND command = ? ORDER BY ROWID DESC LIMIT 1').bind(interaction.member.user.id, tournament_id, command).all();
    if (temp_to_fetch['results'].length > 0) {
      target_id = temp_to_fetch['results'][0]['target_id'];
      await env.DB.prepare('DELETE FROM temp_to WHERE to_id = ? AND tournament_id = ? AND command = ?').bind(interaction.member.user.id, tournament_id, command).run();
    }
    return target_id;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in temp_to_check function.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?').bind(RETURN_CONTENT, error['message'], time_string).run();
    return 'Error';
  }
}

export async function process_register_modals(input) {
  try {
    //process inputs
    var env = input.env;
    var interaction = input.interaction;
    var tournament_id = interaction.guild_id + interaction.channel_id;
    if (input.target) {
      var target_id = input.target;
    } else {
      var target_id = interaction.member.user.id;
    }
    var components_data = {};
    for (let i = 0; i < interaction.data['components'].length; i++) {
      components_data[interaction.data['components'][i]['components'][0]['custom_id']] = interaction.data['components'][i]['components'][0]['value'];
    }
    var name = components_data['modal_name'];
    var pronouns = components_data['modal_pronouns'];
    var deck_name = components_data['modal_deck_name'];
    if (components_data['modal_decklist']) {
      var input_link = components_data['modal_decklist'];
      if (!input_link.startsWith('https://www.moxfield.com/decks/')) {// && !deck_link.startsWith('https://archidekt.com/decks/') && !deck_link.startsWith('https://tappedout.net/mtg-decks/')) {
        return 'Error: Decklink must be a moxfield url. Support for archidekt and tappedout is planned but not currently functional.';
      }
    } else {
      var input_link = '';
    }
    //if player already registered for this channel, update, else, insert; also send confirmation message
    var players_fetch = await env.DB.prepare('SELECT player_id, deck_link FROM players WHERE player_id = ? AND tournament_id = ?').bind(target_id, tournament_id).all();
    var deck_link_text = '';
    if (players_fetch['results'].length > 0) {
      await env.DB.prepare('UPDATE players SET deck_name = ?, name = ?, pronouns = ?, dropped = NULL WHERE player_id = ? AND tournament_id = ?').bind(deck_name, name, pronouns, target_id, tournament_id).run();
      if (input_link && input_link != players_fetch['results'][0]['deck_link']) {
        await env.DB.prepare('UPDATE players SET input_link = ?, deck_link = NULL WHERE player_id = ? AND tournament_id = ?').bind(input_link, target_id, tournament_id).run();
        /*
        var queue = await env.TBQ.send({
          f_call: 'duplicate',
          deck_link: input_link,
          interaction: interaction,
          target_id: target_id
        });
        deck_link_text = ' Grabbing decklist...'
        */
      }
      if (target_id != interaction.member.user.id) {
        return `<@${interaction.member.user.id}> updated <@${target_id}>'s registration!${deck_link_text}`;
      }  
      return `<@${target_id}> updated their tournament registration!${deck_link_text}`;
    } else {
      await env.DB.prepare('INSERT INTO players (player_id, tournament_id, deck_name, input_link, m_score, g_score, name, pronouns) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(target_id, tournament_id, deck_name, deck_link, 0, 0, name, pronouns).run();
      /*
      if (deck_link) {
        var queue = await env.TBQ.send({
          f_call: 'duplicate',
          deck_link: deck_link,
          interaction: interaction,
          target_id: target_id
        });
        deck_link_text = ' Grabbing decklist...'
      }
      */
      if (target_id != interaction.member.user.id) {
        return `<@${interaction.member.user.id}> registered <@${target_id}> for the tournament!${deck_link_text}`;
      } 
      return`<@${target_id}> registered for the tournament!${deck_link_text}`;
    }
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in processing register_modal.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time_string).run();
    return RETURN_CONTENT;
  }
}

export async function process_drop_modals(input) {
  try {
    //process inputs
    var env = input.env;
    var interaction = input.interaction;
    var tournament_id = interaction.guild_id + interaction.channel_id;
    if (input.target) {
      var target_id = input.target;
    } else {
      var target_id = interaction.member.user.id;
    }
    var user_id = interaction.member.user.id;
    //setup round variable for later in function
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT open, round, decklist_pub FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    var round = ongoing_tournaments_fetch['results'][0]['round'];
    //set dropped = 'true' in players
    await env.DB.prepare('UPDATE players SET dropped = ? WHERE tournament_id = ? AND player_id = ?').bind('true', tournament_id, target_id).run();
    //handle round reporting
    var report_fetch = await env.DB.prepare('SELECT player_one, player_two, record_p1, record_p2 FROM pairings WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(tournament_id, target_id, target_id, round).run();
    if (report_fetch['results'].length != 0) {
      if (report_fetch['results'][0]['player_one'] == target_id) {
        var target_is_p1 = true;
        var target_report_field = 'record_p1';
        var opp_report_field = 'record_p2';
        var opponent = report_fetch['results'][0]['player_two'];
      } else {
        var target_is_p1 = false;
        var target_report_field = 'record_p2';
        var opp_report_field = 'record_p1';
        var opponent = report_fetch['results'][0]['player_one'];
      }
      //if player and opponent haven't reported for round, set their round record to 0-2 and opponent's to 2-0
      if (!report_fetch['results'][0]['record_p1'] && !report_fetch['results'][0]['record_p2']) {
        if (target_is_p1) {
          await env.DB.prepare('UPDATE pairings SET record_p1 = ?, record_p2 = ? WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind('0-2', '2-0', tournament_id, target_id, target_id, round).run();
        } else {
          await env.DB.prepare('UPDATE pairings SET record_p2 = ?, record_p1 = ? WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind('0-2', '2-0', tournament_id, target_id, target_id, round).run();
        }
        if (target_id != user_id) {
          return `<@${user_id}> removed <@${target_id}> from the tournament. As match results haven't been reported, <@${opponent}> was given a 2-0 for the round. If this is incorrect, contact TO to override.`;
        }
        return `<@${target_id}> dropped from the tournament. As match results haven't been reported, <@${opponent}> was given a 2-0 for the round. If this is incorrect, contact TO to override.`;
      }
      //if player hasn't reported but opponent has, set player's record to reversed opponent's record
      if (!report_fetch['results'][0][target_report_field] && report_fetch['results'][0][opp_report_field]) {
        var opp_rep = report_fetch['results'][0][opp_report_field];
        var short_regex = /[0-9]+-[0-9]+/i;
        var long_regex = /[0-9]+-[0-9]+-[0-9]+/i;
        if (!short_regex.test(opp_rep) && !long_regex.test(opp_rep)) {
          return `Error: Issue with formatting of opponent's match report. Contact TO to override both match reports. You have been dropped from the tournament.`;
        }
        if (short_regex.test(opp_rep)) {
          var rep_string = reverseString(opp_rep);
        } else if (long_regex.test(opp_rep)) {
          var rep_string = reverseString(opp_rep.substr(0,3)) + opp_rep.substr(3);
        }
        if (user_is_p1) {
          await env.DB.prepare('UPDATE pairings SET record_p1 = ? WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(rep_string, tournament_id, user_id, user_id, round).run();
        } else {
          await env.DB.prepare('UPDATE pairings SET record_p2 = ? WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(rep_string, tournament_id, user_id, user_id, round).run();
        }
        if (target_id != user_id) {
          return `<@${user_id}> removed <@${target_id}> from the tournament. As they hadn't reported, <@${opponent}>'s match results were confirmed.`;
        }
        return `<@${target_id}> dropped from the tournament. As they hadn't reported, <@${opponent}>'s match results were confirmed.`;
      }
    }
    //if both players have reported, user reported but opponent hasn't, or no pairings drop w/o changes to match records
    if (target_id != user_id) {
      return `<@${user_id}> removed <@${target_id}> from the tournament.`;
    }
    return `<@${target_id}> dropped from the tournament.`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in processing drop_modal.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?').bind(RETURN_CONTENT, error['message'], time_string).run();
    return RETURN_CONTENT;
  }
}

export async function process_setup_swaps_modal(input) {
  try{
    //process inputs
    var env = input.env;
    var interaction = input.interaction;  
    var tournament_id = interaction.guild_id + interaction.channel_id;
    var swaps_count = Number(interaction.data['components'][0]['components'][0]['value']);
    if (interaction.data['components'][1]['components'][0]['value'] == 'y') {
      var swaps_pub = 'true';
    } else {
      var swaps_pub = 'false';
    }
    if (interaction.data['components'][2]['components'][0]['value'] == 'y') {
      var swaps_bal = 'true';
    } else {
      var swaps_bal = 'false';
    }
    //make changes
    await env.DB.prepare('UPDATE tournament_defaults SET swaps = ?, swaps_pub = ?, swaps_balanced = ? WHERE id = ?').bind(swaps_count, swaps_pub, swaps_bal, tournament_id).run();
    return `<@${interaction.member.user.id}> updated swap defaults for this channel (swap settings for any ongoing tournament were not changed).`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in processing setup_swaps_modal.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time_string).run();
    return RETURN_CONTENT;
  }
}

export async function process_end_modal(input) {
  try{
    //process inputs
    var env = input.env;
    var interaction = input.interaction;  
    var tournament_id = interaction.guild_id + interaction.channel_id;
    //setup round variable for later in function
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT open, round, decklist_pub, elim_style FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    var round = ongoing_tournaments_fetch['results'][0]['round'];
    if (!round) {
      round = 0;
    }
    var elim_style = ongoing_tournaments_fetch['results'][0]['elim_style'];
    //record points in players
    if (round > 0 && elim_style.toLowerCase() == 'swiss') {
      //get players and current score
      var pre_score_fetch = await env.DB.prepare('SELECT player_id, m_score, mwp, g_score, gwp, played_ids FROM players WHERE tournament_id = ?').bind(tournament_id).all();
      var pre_score = {};
      var m_records = {};
      var g_records = {};
      var played_dict = {};
      var old_mwp = {};
      var old_gwp = {};;
      for (let i = 0; i < pre_score_fetch['results'].length; i++) {
        if (pre_score_fetch['results'][i]['played_ids'] && pre_score_fetch['results'][i]['played_ids'] != '') {
          var played_ids = pre_score_fetch['results'][i]['played_ids'].split(', ');
        } else {
          var played_ids = '';
        }
        m_records[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['m_score'];
        old_mwp[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['mwp'];
        g_records[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['g_score'];
        old_gwp[pre_score_fetch['results'][i]['player_id']] = pre_score_fetch['results'][i]['gwp'];
        played_dict[pre_score_fetch['results'][i]['player_id']] = played_ids;
      }
      //get round results for each player
      var round_results_fetch = await env.DB.prepare('SELECT player_one, record_p1, player_two, record_p2 FROM pairings WHERE tournament_id = ? AND round = ?').bind(tournament_id, round).all();
      var round_results = {};
      for (let i = 0; i < round_results_fetch['results'].length; i++) {
        round_results[round_results_fetch['results'][i]['player_one']] = round_results_fetch['results'][i]['record_p1'];
        round_results[round_results_fetch['results'][i]['player_two']] = round_results_fetch['results'][i]['record_p2'];
      }
      //update scores in players table
      for (let player in round_results) {
        //skip if player is 'bye'
        if (round_results[player] == 'bye') {
          continue;
        }
        try {
          var w_l_d = round_results[player].split('-');  
        } catch (error) {
          //I can't remember why I needed to put this in and it's definitely not a great way to handle whatever bug I was running into
          ////to-do: take this out
          continue;
        }
        var round_wins = Number(w_l_d[0]);
        var round_losses = Number(w_l_d[1]);
        if (!m_records[player]) {
          var player_m_record = 0;
        } else {
          var player_m_record = Number(m_records[player]);
        }
        if (!g_records[player]) {
          var player_g_record = 0;
        } else {
          var player_g_record = Number(m_records[player]);
        }
        var round_ties = 0;
        if (w_l_d.length == 3) {
          round_ties = Number(w_l_d[2]);
        }
        var new_g_record = player_g_record + (round_wins * 3) + round_ties;
        //setup new m_record
        if (round_wins > round_losses) {
          //player won match
          var new_m_record = player_m_record + 3;
        } else if (round_wins == round_losses) {
          //player tied match
          var new_m_record = player_m_record + 1;
        } else {
          //if player lost match
          var new_m_record = player_m_record;
        }
        var new_mwp = (new_m_record / (played_dict[player].length * 3)).toFixed(4);
        var new_gwp = (new_g_record / (played_dict[player].length * 3)).toFixed(4);
        await env.DB.prepare('UPDATE players SET m_score = ?, mwp = ?, g_score = ?, gwp = ? WHERE player_id = ? AND tournament_id = ?').bind(new_m_record, new_mwp, new_g_record, new_gwp, player, tournament_id).run();
      }
    }
    //make final standings
    var standings_input = {
      'env': env,
      'interaction': interaction
    }
    var standings_output = await standings(standings_input);
    //move tournament content to archive_tournaments, archive_pairings, and archive_players
    var time = new Date();
    var time_string = time.toString();
    //move from ongoing_tournaments
    await env.DB.prepare('INSERT INTO temp_tournaments (id, open, round, decklist_req, decklist_pub, elim_style, t_format, swaps, swaps_pub, swaps_balanced, t_name ,to_moxfield) SELECT id, open, round, decklist_req, decklist_pub, elim_style, t_format, swaps, swaps_pub, swaps_balanced, t_name ,to_moxfield FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).run();
    await env.DB.prepare('UPDATE temp_tournaments SET archival_time = ?').bind(time_string).run();
    await env.DB.prepare('INSERT INTO archive_tournaments SELECT * from temp_tournaments').run();
    await env.DB.prepare('DELETE FROM temp_tournaments').run();
    //move from pairings
    await env.DB.prepare('INSERT INTO temp_pairings (tournament_id, round, player_one, player_two, record_p1, record_p2, p1_adds, p2_adds, p1_cuts, p2_cuts) SELECT tournament_id, round, player_one, player_two, record_p1, record_p2, p1_adds, p2_adds, p1_cuts, p2_cuts FROM pairings WHERE tournament_id = ?').bind(tournament_id).run();
    await env.DB.prepare('UPDATE temp_pairings SET archival_time = ?').bind(time_string).run();
    await env.DB.prepare('INSERT INTO archive_pairings SELECT * from temp_pairings').run();
    await env.DB.prepare('DELETE FROM temp_pairings').run();
    //move from players
    await env.DB.prepare('INSERT INTO temp_players (player_id, tournament_id, deck_name, deck_link, played_ids, m_score, mwp, g_score, gwp, received_bye, name, dropped, eliminated) SELECT player_id, tournament_id, deck_name, deck_link, played_ids, m_score, mwp, g_score, gwp, received_bye, name, dropped, eliminated FROM players WHERE tournament_id = ?').bind(tournament_id).run();
    await env.DB.prepare('UPDATE temp_players SET archival_time = ?').bind(time_string).run();
    await env.DB.prepare('INSERT INTO archive_players SELECT * from temp_players').run();
    await env.DB.prepare('DELETE FROM temp_players').run();
    //delete original data at end incase of errors
    await env.DB.prepare('DELETE FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).run();
    await env.DB.prepare('DELETE FROM pairings WHERE tournament_id = ?').bind(tournament_id).run();
    await env.DB.prepare('DELETE FROM players WHERE tournament_id = ?').bind(tournament_id).run();
    await env.DB.prepare('DELETE FROM temp_to WHERE tournament_id = ?').bind(tournament_id).run();
    //return confirmation
    var RETURN_CONTENT = `<@${interaction.member.user.id}> ended the tournament. Data was successfully archived. Final standings:\n\n`;
    RETURN_CONTENT += standings_output;
    return RETURN_CONTENT;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in processing end_modal.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time_string).run();
    return RETURN_CONTENT;
  }
}

export async function process_swaps_modal(input) {
  try{
    //process inputs
    var env = input.env;
    var interaction = input.interaction;  
    var tournament_id = interaction.guild_id + interaction.channel_id;
    //setup round variable for later in function
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT open, round, swaps_pub FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    var round = ongoing_tournaments_fetch['results'][0]['round'];
    if (ongoing_tournaments_fetch['results'][0]['swaps_pub'] == 'true') {
      var swaps_pub = true;
    } else {
      var swaps_pub = false;
    }
    //record swaps
    var adds = interaction.data['components'][0]['components'][0]['value'];
    var cuts = interaction.data['components'][1]['components'][0]['value'];
    //figure out where to record swaps and record
    var report_fetch = await env.DB.prepare('SELECT player_one, player_two FROM pairings WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(tournament_id, interaction.member.user.id, interaction.member.user.id, round).all();
    if (report_fetch['results'].length == 0) {
      return `Error: You are not included in the current round's pairings.`;
    }
    if (report_fetch['results'][0]['player_one'] == interaction.member.user.id) {
      await env.DB.prepare('UPDATE pairings SET p1_adds = ?, p1_cuts = ? WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(adds, cuts, tournament_id, interaction.member.user.id, interaction.member.user.id, round).run();
    } else {
      await env.DB.prepare('UPDATE pairings SET p2_adds = ?, p2_cuts = ? WHERE tournament_id = ? AND (player_one = ? OR player_two = ?) AND round = ?').bind(adds, cuts, tournament_id, interaction.member.user.id, interaction.member.user.id, round).run();
    }
    //send confirmation
    var RETURN_CONTENT = `<@${interaction.member.user.id}> submitted swaps for the round!`
    if (swaps_pub) {
      RETURN_CONTENT += `\n\nAdds:\n${adds}\n\nCuts:\n${cuts}`;
    }
    return RETURN_CONTENT;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'An error occured in processing swaps_modal.';
    var time = new Date();
    var time_string = time.toString();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time_string).run();
    return RETURN_CONTENT;
  }
}

function findNthOccurrence(str, char, n) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
      if (str[i] === char) {
          count++;
          if (count === n) {
              return i;
          }
      }
  }
  return -1;
}

export async function send_output(input) {
  try {
    //unpack input
    var message = input.message;
    if (input.edit_url) {
      var edit_url = input.edit_url;  
    }
    var interaction = input.interaction;
    var env = input.env;
    var mentions = [];
    if (input.mentions) {
      mentions = input.mentions;
    }
    var at_ten = findNthOccurrence(message, '@', 10);
    var newline_after_at_ten = -1;
    if (at_ten != -1) {
      newline_after_at_ten = message.indexOf('\n', at_ten);
    }
    if (message.length < 2000 && newline_after_at_ten === -1) {
      if (edit_url) {
        let res = await axios.patch(edit_url, {content: message, allowed_mentions: {parse: mentions}});
        return;
      }
      await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        },
        method: 'POST',
        body: JSON.stringify({
              content: message, 
              allowed_mentions: {parse: mentions}
            })
      });
      return;
    }
    //cut input at first newline before 2000th character, repeat until length > 2000, send first as a patch and remaining as new message
    var message_array = [];
    var i = 0;
    while (message.length > 2000 || newline_after_at_ten > 0) {
      let cut_at = (newline_after_at_ten < 2000) ? newline_after_at_ten:2000;
      let test_str = message.substr(0, cut_at);
      let index = test_str.lastIndexOf('\n');
      message_array[i] = test_str.substr(0, index);
      message = message.substr(index);
      var at_ten = findNthOccurrence(message, '@', 10);
      var newline_after_at_ten = message.indexOf('\n', at_ten);
      i++;
    }
    message_array[i] = message;
    var start = 0;
    if (edit_url) {
      let res = await axios.patch(edit_url, {content: message_array[0], allowed_mentions: {parse: mentions}});
      start++;
    }
    for (let i = start; i < message.length; i++) {
      var res_1 = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        },
        method: 'POST',
        body: JSON.stringify({
              content: message_array[i], 
              allowed_mentions: {parse: mentions}
            })
      });
    }
    return;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in send_output function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function process_feedback_modal(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    //send feedback message to feedback channel
    await fetch(`https://discord.com/api/v10/channels/1260759849398964304/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        },
        method: 'POST',
        body: JSON.stringify({
              content: interaction.data['components'][0]['components'][0]['value']
            })
      });
    return `Your feedback was sent, thanks!`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in reopen function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function migrate(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    //change tournament_id in all ongoing_tournaments, players, and pairings
    var new_tournament_id = interaction.guild_id + interaction.data.options[0]['value'];
    await env.DB.prepare('UPDATE ongoing_tournaments SET id = ? WHERE id = ?').bind(new_tournament_id, tournament_id).run();
    await env.DB.prepare('UPDATE players SET tournament_id = ? WHERE tournament_id = ?').bind(new_tournament_id, tournament_id).run();
    await env.DB.prepare('UPDATE pairings SET tournament_id = ? WHERE tournament_id = ?').bind(new_tournament_id, tournament_id).run();
    //send message in migrated channel
    await fetch(`https://discord.com/api/v10/channels/${interaction.data.options[0]['value']}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        },
        method: 'POST',
        body: JSON.stringify({
              content: `<@${interaction.member.user.id}> moved a tournament into this channel!`
            })
      });
    return `<@${interaction.member.user.id}> moved tournament to <#${interaction.data.options[0]['value']}>.`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in reopen function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}

export async function check_registered(input) {
  try {
    //process inputs
    let env = input.env;
    let interaction = input.interaction;
    let tournament_id = interaction.guild_id + interaction.channel_id;
    //make list of registered players
    var player_data_fetch = await env.DB.prepare('SELECT player_id, deck_name, deck_link, name, pronouns FROM players WHERE tournament_id = ?').bind(tournament_id).run();
    var ongoing_tournaments_fetch = await env.DB.prepare('SELECT decklist_pub FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
    var guildUrl = `https://discord.com/api/v10/guilds/${interaction.guild_id}`
    var response = await fetch(guildUrl, {
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      }, 
      method:'GET',
    });
    var guild_data = await response.json();
    var player_list = `Users registered for the tournament in the ${interaction.channel.name} channel of the ${guild_data.name} server:`;
    for (let i = 0; i < player_data_fetch['results'].length; i++) {
      var p_name = player_data_fetch['results'][i]['name'];
      var format_p_l = '';
      var format_p_r = '';
      if (p_name) {
        var format_p_l = ' (';
        var format_p_r = ')';
      }
      var p = player_data_fetch['results'][i]['player_id'];
      if (p_name && player_data_fetch['results'][i]['pronouns']) {
        p_name += ` (${player_data_fetch['results'][i]['pronouns']})`;
      } else if (player_data_fetch['results'][i]['pronouns']) {
        format_p_r += ` (${player_data_fetch['results'][i]['pronouns']})`;
      }
      if (ongoing_tournaments_fetch['results'][0]['decklist_pub'] == 'true') {
        var p_deck_name = player_data_fetch['results'][i]['deck_name'];
        var p_deck_link = player_data_fetch['results'][i]['deck_link'];
        player_list += `\n${p_name}${format_p_l}<@${p}>${format_p_r} on [${p_deck_name}](<${p_deck_link}>)`;
      } else {
        player_list += `\n${p_name}${format_p_l}<@${p}>${format_p_r}`;
      }
    }
    //create DM with calling user
    var result = await axios.post('https://discord.com/api/v10/users/@me/channels', {
      recipient_id: interaction.member.user.id}, 
      {headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      }});
    //send list via DM (use send_output function)
    var input = {message: player_list, interaction: interaction, env: env};
    input.interaction.channel_id = result.data.id;
    await send_output(input);
    return `Successfully sent list of registered users via DM.`;
  } catch (error) {
    console.log(error);
    var RETURN_CONTENT = 'Error occured in check_registered function.';
    var time = new Date();
    await env.DB.prepare('INSERT INTO errors (error, description, time) VALUES (?, ?, ?)').bind(RETURN_CONTENT, error['message'], time.toString()).run();
    return RETURN_CONTENT;
  }
}
