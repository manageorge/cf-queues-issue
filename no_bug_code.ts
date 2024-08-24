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
    if (message.length < 2000) {
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
    while (message.length > 2000) {
      let test_str = message.substr(0, 2000);
      let index = test_str.lastIndexOf('\n');
      message_array[i] = test_str.substr(0, index);
      message = message.substr(index);
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
