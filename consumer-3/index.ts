/**
 * This is a worker related to consumer-2, testing automation of a process using browser rendering.
 * This worker/queue experiences 15 minute delays between consuming messages.
 * Lots of code below is commented out as I've been trying to place where in my code I'm causing the 15 minute delays.
 * Realized this may be related to the delays I'm seeing in the other two queues/consumers.
 * Commented code in the fetch request is functional. Uncommented code in the queue request is functional, except for the delays.
 */

import puppeteer from "@cloudflare/puppeteer";
import {
	//duplicate,
	send_output
} from './browser_functions.js';

//interface Env {
	//DB: D1Database;
	//MYBROWSER: Fetcher;
//}

export default {
	async queue(batch, env): Promise<void> {
		console.log('received queue message')
		var messages = JSON.stringify(batch.messages);
    	var parsed = JSON.parse(messages);
    	var interaction = parsed[0]['body']['interaction'];
    	var f_call = parsed[0]['body']['f_call'];
    	switch (f_call) {
    		case 'duplicate': {
    			try {
						var browser = await puppeteer.launch(env.MYBROWSER);	
					} catch (error) {
						console.log(error)
						//return new Response(error);
					}
					if (browser) {
						try {
					    const page = await browser.newPage();
					    //login process
					    await page.goto('https://www.moxfield.com/account/signin');
					    await page.type('#username', 'TOBot');
					    await page.type('#password', env.MFPW);
					    await page.keyboard.press('Enter');
					    await page.waitForNavigation();
					    //go to decklist and duplicate
					    await page.goto('https://www.moxfield.com/decks/_viNg0j2eEW7_vLnjIvWUw');
					    //more button
					    await page
					    	.waitForSelector('#subheader-more')
					    	.then(() => page.click('#subheader-more'));
					    //duplicate in more menu
					    var elem = await page.$$eval('a', items => {
								for (const item of items) {
							 		console.log(item.textContent);
							  	if (item.textContent === 'Duplicate') {
							    	item.click();
							    	break; // Click the first matching item and exit the loop
							  	}
								}
							});
				      //new deck name
				      await page
				      	.waitForSelector('#name')
				      	.then(() => page.type('#name', 'CF automation testing!'));
				      //confirm duplication
				      await page.keyboard.press('Enter');
				      //wait for new deck page to load
				      await page.waitForNavigation();
				      var img = (await page.screenshot()) as Buffer;
				      var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'deck duplicated, closing'
				            })
				      });
				      await browser.close();
				      //return new Response(img, {
								//headers: {
									//"content-type": "image/jpeg",
								//},
							//});
						} catch (error) {
							var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'error occured, closing'
				            })
				      });
							await browser.close();
							//return new Response(error);
						}
					}

		    	/*
    			////
    			try {
	    			var deck_link = parsed[0]['body']['deck_link'];
	    			var target_id = parsed[0]['body']['target_id'];
	    			var input = {
	    				'deck_link': deck_link,
	    				'target_id': target_id,
	    				'interaction': interaction,
	    				'env': env
	    			};
	    			
	    			//var tournament_id = interaction.guild_id + interaction.channel_id;
	    			//var ongoing_tournaments_fetch = await env.DB.prepare('SELECT t_name FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
					//console.log('from index.ts:')
					//console.log(ongoing_tournaments_fetch)
					
	    			//var outcome = duplicate(input);
	    			//console.log('fetching info from DB')
	    			var tournament_id = interaction.guild_id + interaction.channel_id;
					//setup deck name
					var ongoing_tournaments_fetch = await env.DB.prepare('SELECT t_name FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
					var players_fetch = await env.DB.prepare('SELECT deck_name, name FROM players WHERE tournament_id = ? AND player_id = ?').bind(tournament_id, target_id).all();
					var deck_name = players_fetch['results'][0]['deck_name'];
					if (players_fetch['results'][0]['name']) {
						var player_name = players_fetch['results'][0]['name'];
					} else {
						var response = await fetch(`https://discord.com/api/v10/users/${interaction.member.user.id}`, {
							headers: {
								Authorization: `Bot ${env.DISCORD_TOKEN}`
							},
							method: 'GET',
						});
						var user = await response.json();
						var player_name = user.username;
					}
					var t_name_placeholder = '';
					if (ongoing_tournaments_fetch['results'][0]['t_name']) {
						t_name_placeholder = ` - ${ongoing_tournaments_fetch['results'][0]['t_name']}`;
					}
					var moxfield_deck_name = `${deck_name} by ${player_name}${t_name_placeholder}`;
					//duplicate deck
					var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'starting web browser duplication'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
					const browser = await puppeteer.launch(env.MYBROWSER);
					try {
				    	const page = await browser.newPage();
				    	//await page.setDefaultTimeout(3000);
				      	//login process
				      	var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'starting login'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page.goto('https://www.moxfield.com/account/signin');
				      	await page
				      		.waitForSelector('#username')
				      		.then(() => page.type('#username', `TOBot`));
				      	var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'input username (done)'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	//await page.type('#username', 'TOBot'); //replace with real usernsme
				      	await page.type('#password', env.MFPW); //place this in a secret (and replace with real password)
				      	var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'input password (done)'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page.keyboard.press('Enter');
				      	await new Promise(r => setTimeout(r, 5000));
				      	//go to decklist and duplicate
				      	var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'moving to decklist page'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page.goto(deck_link);
				      	//more button
				      	var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'more button'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page
				      		.waitForSelector('#subheader-more')
				      		.then(() => page.click('#subheader-more'));
				      	//duplicate in more menu
				      		var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'duplicate in more menu'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page.$$eval('a', async items => {
						    for (const item of items) {
						    	console.log(item.textContent);
						      if (item.textContent === 'Duplicate') {
						        item.click();
						        var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'clicked duplicate!'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
						        break; // Click the first matching item and exit the loop
						      }
						    }
						  });
				      	//new deck name
				      		var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'setting deckname'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page
				      		.waitForSelector('#name')
				      		.then(() => page.type('#name', `${moxfield_deck_name}`));
				      	//confirm duplication
				      			var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: 'confirming deckname'
				              //allowed_mentions: {parse: mentions}
				            })
				      });
				      	await page.keyboard.press('Enter');
				      	//wait for new deck page to load
				      	//await page.waitForNavigation();
				      	await new Promise(r => setTimeout(r, 5000));
				      	//grab new decklink
				      	var updated_deck_link = await page.url();
				      	//close browser to prevent multiples
				      	await browser.close();
				      	//put new decklink into players table
				      	await env.DB.prepare('UPDATE players SET deck_link = ? WHERE player_id = ? AND tournament_id = ?').bind(updated_deck_link, target_id, tournament_id).run();
				      	var outcome = 'Success';
					} catch (error) {
						await browser.close();
						var outcome = error;
					}
	    			//send message based on output of duplicate function
	    			var output = {};
	    			if (outcome == 'Success') {
	    				output.message = `<@${target_id}>'s deck was successfully recorded!`;
	    			} else {
	    				output.message = `Error duplicating <@${target_id}>'s deck:\n${error}`;
	    			}
	    			output.interaction = interaction;
	    			//await send_output(output);
	    			var res = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
				        headers: {
				          'Content-Type': 'application/json',
				          Authorization: `Bot ${env.DISCORD_TOKEN}`,
				        },
				        method: 'POST',
				        body: JSON.stringify({
				              content: output.message
				              //allowed_mentions: {parse: mentions}
				            })
				      });
	    			console.log(res)
	    		} catch (error) {
	    			console.log(error)
	    		}
	    		*/
	    		////
    			break;
    		}
    		case 'share': {
    			var to_moxfield = parsed[0]['body']['to_moxfield'];
    			var input = {
    				interaction: interaction,
    				env: env,
    				to_moxfield: to_moxfield
    			}
    			await share(input);
    			break;
    		}
    	}
	},
	async fetch(request, env, ctx): Promise<Response> {
		return new Response('hello');
		/*
		try {
			var browser = await puppeteer.launch(env.MYBROWSER);	
		} catch (error) {
			return new Response(error);
		}
		try {
	      	const page = await browser.newPage();
	      	//login process
	      	await page.goto('https://www.moxfield.com/account/signin');
	      	await page.type('#username', 'TOBot');
	      	await page.type('#password', env.MFPW);
	      	await page.keyboard.press('Enter');
	      	//await new Promise(r => setTimeout(r, 2000));
	      	await page.waitForNavigation();
	      	//go to decklist and duplicate
	      	await page.goto('https://www.moxfield.com/decks/_viNg0j2eEW7_vLnjIvWUw');
	      	//more button
	      	await page
	      		.waitForSelector('#subheader-more')
	      		.then(() => page.click('#subheader-more'));
	      	//duplicate in more menu
	      	var elem = await page.$$eval('a', items => {
			    for (const item of items) {
			    	console.log(item.textContent);
			      if (item.textContent === 'Duplicate') {
			        item.click();
			        break; // Click the first matching item and exit the loop
			      }
			    }
			  });
	      	//new deck name
	      	await page
	      		.waitForSelector('#name')
	      		.then(() => page.type('#name', 'CF automation testing!'));
	      	//confirm duplication
	      	await page.keyboard.press('Enter');
	      	//wait for new deck page to load
	      	//await new Promise(r => setTimeout(r, 2000));
	      	await page.waitForNavigation();
	      	/*
	      	//more button
	      	await page
	      		.waitForSelector('#subheader-more')
	      		.then(() => page.click('#subheader-more'));
	      	//change authors button
	      	await page
	      		.waitForSelector('a.no-outline:nth-child(4)')
	      		.then(() => page.click('a.no-outline:nth-child(4)'));
	      	//allow other authors to edit button
	      	await page
	      		.waitForSelector('a.text-info')
	      		.then(() => page.click('a.text-info'));
	      	//add author
	      	await page
	      		.waitForSelector('form.dropdown:nth-child(2) > div:nth-child(1) > input:nth-child(1)')
	      		.then(() => page.type('form.dropdown:nth-child(2) > div:nth-child(1) > input:nth-child(1)', 'manageorge'));
	      	await page
	      		.waitForSelector('html body.preloaded-styles.decksocial-visible.deckfooter-visible.modal-open div.dropdown-menu.dropdown-scrollable.show a.dropdown-item.text-ellipsis.cursor-pointer.no-outline')
	      		.then(() => page.click('html body.preloaded-styles.decksocial-visible.deckfooter-visible.modal-open div.dropdown-menu.dropdown-scrollable.show a.dropdown-item.text-ellipsis.cursor-pointer.no-outline'));
	      	/
	      	var img = (await page.screenshot()) as Buffer;
	      	await browser.close();
	      	return new Response(img, {
				headers: {
					"content-type": "image/jpeg",
				},
			});
		} catch (error) {
			
			await browser.close();
			return new Response(error);
			
			/*
			let img = (await page.screenshot()) as Buffer;
	      	await browser.close();
	      	return new Response(img, {
				headers: {
					"content-type": "image/jpeg",
				},
			});
			/
		}
		*/
	},
}; //satisfies ExportedHandler<Env>;

async function duplicate(input) {
	//process input
	var deck_link = input.deck_link;
	var target_id = input.target_id;
	var interaction = input.interaction;
	var env = input.env;
	var tournament_id = interaction.guild_id + interation.channel_id;
	//setup deck name
	var ongoing_tournaments_fetch = await env.DB.prepare('SELECT t_name FROM ongoing_tournaments WHERE id = ?').bind(tournament_id).all();
	console.log(ongoing_tournaments_fetch)
	var players_fetch = await env.DB.prepare('SELECT deck_name, name FROM players WHERE tournament_id = ? AND player_id = ?').bind(tournament_id, target_id).all();
	var deck_name = players_fetch['results'][0]['deck_name'];
	if (players_fetch['results'][0]['name']) {
		var player_name = players_fetch['results'][0]['name'];
	} else {
		var response = await fetch(`https://discord.com/api/v10/users/${interaction.member.user.id}`, {
			headers: {
				Authorization: `Bot ${env.DISCORD_TOKEN}`
			},
			method: 'GET',
		});
		var user = await response.json();
		var player_name = user.username;
	}
	var t_name_placeholder = '';
	if (ongoing_tournaments_fetch['results'][0]['t_name']) {
		t_name_placeholder = ` - ${ongoing_tournaments_fetch['results'][0]['t_name']}`;
	}
	var moxfield_deck_name = `${deck_name} by ${player_name}${t_name_placeholder}`;
	//duplicate deck
	const browser = await puppeteer.launch(env.MYBROWSER);
	try {
    	const page = await browser.newPage();
      	//login process
      	await page.goto('https://www.moxfield.com/account/signin');
      	await page.type('#username', 'TOBot'); //replace with real usernsme
      	await page.type('#password', env.MFPW); //place this in a secret (and replace with real password)
      	await page.keyboard.press('Enter');
      	await page.waitForNavigation();
      	//go to decklist and duplicate
      	await page.goto(deck_link);
      	//more button
      	await page
      		.waitForSelector('#subheader-more')
      		.then(() => page.click('#subheader-more'));
      	//duplicate in more menu
      	await page
      		.waitForSelector('body > div.dropdown-menu.show > div > div > div:nth-child(1) > a:nth-child(2)')
      		.then(() => page.click('body > div.dropdown-menu.show > div > div > div:nth-child(1) > a:nth-child(2)'));
      	//new deck name
      	await page
      		.waitForSelector('#name')
      		.then(() => page.type('#name', `${moxfield_deck_name}`));
      	//confirm duplication
      	await page.keyboard.press('Enter');
      	//wait for new deck page to load
      	await page.waitForNavigation();
      	//grab new decklink
      	var updated_deck_link = await page.url();
      	//close browser to prevent multiples
      	await browser.close();
      	//put new decklink into players table
      	await env.DB.prepare('UPDATE players SET deck_link = ? WHERE player_id = ? AND tournament_id = ?').bind(updated_deck_link, target_id, tournament_id).run();
      	return 'Success';
	} catch (error) {
		await browser.close();
		return error;
	}
}

export async function share(input) {
	//process inputs
	var env = input.env;
	var interaction = input.interaction;
	var tournament_id = interaction.guild_id + interaction.channel_id;
	var to_moxfield = input.to_moxfield;
	var players_null_fetch = await env.DB.prepare('SELECT player_id FROM players WHERE tournament_id = ? AND deck_link IS NULL').bind(tournament_id).all();
	var i = 0;
	while (players_null_fetch['results'].length > 0) {
		await new Promise(r => setTimeout(r, 2000));
		players_null_fetch = await env.DB.prepare('SELECT player_id FROM players WHERE tournament_id = ? AND deck_link IS NULL').bind(tournament_id).all();
		if (i > 30) {
			return 'Timeout error - at least one deck_link was not correctly set.';
		}
		i ++;
	}
	//share decks using for loop
	const browser = await puppeteer.launch(env.MYBROWSER);
	var players_fetch = await env.DB.prepare('SELECT deck_link FROM players WHERE tournament_id = ?').bind(tournament_id).all();
	var status = `Sharing decklists. Shared 0 of ${players_fetch['results'].length} decks.`;
	var message = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${env.DISCORD_TOKEN}`,
        },
        method: 'POST',
        body: JSON.stringify({
              content: status
            })
    });
	try {
		const page = await browser.newPage();
		for (i = 0; i > players_fetch['results'].length; i++) {
			//go to deck page
			await page.goto(players_fetch['results'][i]['deck_link']);
			//wait for deck page to load
	      	await page.waitForNavigation();
	      	//more button
	      	await page
	      		.waitForSelector('#subheader-more')
	      		.then(() => page.click('#subheader-more'));
	      	//change authors button
	      	await page
	      		.waitForSelector('a.no-outline:nth-child(4)')
	      		.then(() => page.click('a.no-outline:nth-child(4)'));
	      	//allow other authors to edit button
	      	await page
	      		.waitForSelector('a.text-info')
	      		.then(() => page.click('a.text-info'));
	      	//add author
	      	await page
	      		.waitForSelector('form.dropdown:nth-child(2) > div:nth-child(1) > input:nth-child(1)')
	      		.then(() => page.type('form.dropdown:nth-child(2) > div:nth-child(1) > input:nth-child(1)', `${to_moxfield}`));
	      	await page
	      		.waitForSelector('html body.preloaded-styles.decksocial-visible.deckfooter-visible.modal-open div.dropdown-menu.dropdown-scrollable.show a.dropdown-item.text-ellipsis.cursor-pointer.no-outline')
	      		.then(() => page.click('html body.preloaded-styles.decksocial-visible.deckfooter-visible.modal-open div.dropdown-menu.dropdown-scrollable.show a.dropdown-item.text-ellipsis.cursor-pointer.no-outline'));
	      	var n = i + 1;
	      	status = `Sharing decklists. Shared ${n} of ${players_fetch['results'].length} decks.`;
	      	message = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
		        headers: {
		          'Content-Type': 'application/json',
		          Authorization: `Bot ${env.DISCORD_TOKEN}`,
		        },
		        method: 'PATCH',
		        body: JSON.stringify({
		              content: status
		            })
		    });
		}
		//close browser
		await broswer.close();
		return 'Success';
	} catch (error) {
		status = `Error sharing decklists. Successfully shared ${n} of ${players_fetch['results'].length} decks.`;
      	message = await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages`, {
	        headers: {
	          'Content-Type': 'application/json',
	          Authorization: `Bot ${env.DISCORD_TOKEN}`,
	        },
	        method: 'PATCH',
	        body: JSON.stringify({
	              content: status
	            })
	    });
		await browser.close();
		return error;
	}
}
