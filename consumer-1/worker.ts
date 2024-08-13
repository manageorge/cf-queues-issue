/**
 * This worker gets passed a discord interaction through the queue from a producer worker. 
 * This queue/worker is not experiencing the delay in moving to the next message.
 */

import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
  MessageComponentTypes,
  InteractionResponseFlags,
} from 'discord-interactions';
import axios from 'axios';
import {
  pair,
  open,
  close,
  pairing,
  missing_results,
  standings,
  reopen,
  autofill,
  autoreport,
  process_defaults_modal,
  process_register_modals,
  process_drop_modals,
  process_setup_swaps_modal,
  process_end_modal,
  process_swaps_modal,
  temp_to_check,
  send_output,
  process_feedback_modal,
  migrate,
  check_registered,
  process_report_modals
} from './processing_functions.js'

export default {
  async fetch(request, env, ctx) {
    return new Response('Hello World!');
  },
  async queue(batch, env): Promise<void> {
    var messages = JSON.stringify(batch.messages);
    var parsed = JSON.parse(messages);
    var interaction = parsed[0]['body'];
    var edit_url = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      switch (interaction.data.name.toLowerCase()) {
        case 'open': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await open(input);
          break;
        }
        case 'close': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await close(input);
          break;
        }
        case 'pair': {
          var input = {
            'env': env,
            'tournament_id': interaction.guild_id + interaction.channel_id
          };
          var mentions = ['users'];
          var output = await pair(input);
          break;
        }
        case 'pairing': {
          var input = {
            'env': env,
            'interaction': interaction
          };
          var output = await pairing(input);
          break;
        }
        case 'missing_results': {
          var input = {
            'env': env,
            'interaction': interaction
          };
          var output = await missing_results(input);
          var mentions = [];
          //set user ping
          if (interaction.data.options && interaction.data.options[0]['value'].toLowerCase() == 'y') {
            mentions = ['users'];
          }
          break;
        }
        case 'standings': {
          var input = {
            'env': env,
            'interaction': interaction
          };
          var output = await standings(input);
          break;
        }
        case 'reopen': {
          var input = {
            'env': env,
            'interaction': interaction
          };
          var output = await reopen(input);
          break;
        }
        case 'autofill': {
          var input = {
            'env': env,
            'interaction': interaction
          };
          var output = await autofill(input);
          break;
        }
        case 'autoreport': {
          var input = {
            'env': env,
            'interaction': interaction
          };
          var output = await autoreport(input);
          break;
        }
        case 'migrate': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await migrate(input);
          break;
        }
        case 'check_registered': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await check_registered(input);
          break;
        }
        default:
          var output = `Error: Unrecognized command "${interaction.data.name.toLowerCase()}"`;
      }
      var send = {
        message: output,
        edit_url: edit_url,
        interaction: interaction,
        env: env
      }
      if (mentions) {
        send.mentions = mentions;
      }
      await send_output(send);
    }
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      switch (interaction.data.custom_id.toLowerCase()) {
        case 'slash_set_defaults_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_defaults_modal(input);
          break;
        }
        case 'slash_register_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_register_modals(input);
          break;
        }
        case 'slash_register_other_modal': {
          var input = {
            'env': env,
            'interaction': interaction,
            'command': 'register_other'
          }
          input.target = await temp_to_check(input);
          if (input.target == 'Error') {
            var output = 'An error occured in temp_to_check function.';
            break;
          }
          var mentions = ['users'];
          var output = await process_register_modals(input);
          break;
        }
        case 'slash_drop_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_drop_modals(input);
          break;
        }
        case 'slash_drop_other_modal': {
          var input = {
            'env': env,
            'interaction': interaction,
            'command': 'drop_other'
          }
          input.target = await temp_to_check(input);
          if (input.target == 'Error') {
            var output = 'An error occured in temp_to_check function.';
            break;
          }
          var mentions = ['users'];
          var output = await process_drop_modals(input);
          break;
        }
        case 'slash_setup_swaps_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_setup_swaps_modal(input);
          break;
        }
        case 'slash_end_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_end_modal(input);
          break;
        }
        case 'slash_swaps_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_swaps_modal(input);
          break;
        }
        case 'slash_feedback_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_feedback_modal(input);
          break;
        }
        case 'slash_report_modal': {
          var input = {
            'env': env,
            'interaction': interaction
          }
          var output = await process_report_modals(input);
          break;
        }
        case 'slash_report_other_modal': {
          var input = {
            'env': env,
            'interaction': interaction,
            'command': 'report_other'
          }
          input.target = await temp_to_check(input);
          if (input.target == 'Error') {
            var output = 'An error occured in temp_to_check function.';
            break;
          }
          var mentions = ['users'];
          var output = await process_report_modals(input);
          break;
        }
        default:
          var output = `Error: Unrecognized modal "${interaction.data.custom_id.toLowerCase()}"`;
      }
      var send = {
        message: output,
        edit_url: edit_url,
        interaction: interaction,
        env: env
      }
      if (mentions) {
        send.mentions = mentions;
      }
      await send_output(send);
    }
  },
};
