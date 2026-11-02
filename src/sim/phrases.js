// Phrase banks for simulated chat (demo, evaluation, tests).
export const SUPPORT_LEFT = [
  'left','go left','LEFT!!','left looks safer','take the left route','left left left','leeeeft','left 100%',
  'left is the way','LEFT PLS','def left','go left chat','lefft','left obviously','trust me left','left is safer',
  'left > right','left not right','LEFT','left!','go leftttt','left for sure','Left.','i say left','left side',
  'LEFT LEFT','gotta be left','left easy','left!!!!','go left bro',
];
export const OPPOSE_RIGHT = [
  "don't go right",'right is a trap','anything but right','avoid right','right looks dangerous','never right',
  'not right','right is bad','dont do right','right is death','skip right','right is sus','no right',
  'right = trap','right is risky','avoid right lol',
];
export const HINT_LEFT = ['first door','take the first door','door 1','first one','FIRST DOOR'];
export const QUESTIONS_LEFT = [
  'why is everyone saying left?','left or right?','is left better?','whats on the left?','why left tho?',
  'everyone is spamming left lol','should we go left?','left or right chat?','wait why left?',
];
export function swapLR(s) {
  return s.replace(/left|LEFT|Left|right|RIGHT|Right|lefft|leeeeft|leftttt/g, (m) => {
    const map={left:'right',LEFT:'RIGHT',Left:'Right',right:'left',RIGHT:'LEFT',Right:'Left',lefft:'rigght',leeeeft:'riiiight',leftttt:'righttt'};
    return map[m];
  });
}
export const SUPPORT_RIGHT=SUPPORT_LEFT.map(swapLR);
export const OPPOSE_LEFT=OPPOSE_RIGHT.map(swapLR);
export const HINT_RIGHT=['second door','take the second door','door 2','second one','SECOND DOOR'];
export const CHATTER=[
  'hi chat','lol','this music slaps','gg','what time is it there','first time watching','love the stream','lmao','nice',
  'brb food','hello from brazil','chat is wild today','o7','true','i need sleep','that was funny','classic','monkaS',
  'hey streamer','how was your day','my dog says hi','good vibes','whats the song','back from work','ok','real','haha',
  'hydrate','this boss is hard','so good','nice outfit','the lighting is nice','hello','peepoHey','just got here','cozy stream',
];
export const CONFUSED_GIVEAWAY=[
  'wait how do we enter the giveaway?','how do i get in the giveaway','giveaway rules?', "where's the giveaway link",
  'im so lost what giveaway','how to join giveaway?','what do i type for the giveaway','confused about the giveaway',
  'do i need to follow for the giveaway?','what are the giveaway rules??','wait what giveaway','how does the giveaway work',
  'is the giveaway still open?','how do you even enter the giveaway lol',
];
export const THANKS_AFTER=['ohh got it','thanks!','entered','ty streamer','ok makes sense','done','nice ty'];
export const REMATCH=['run that back','REMATCH','again again','one more game','do it again!!','rematchhhh','go again pls','another round','run it back now','one more pls','once more pls','replay that','we need a rematch','AGAIN'];
export const HYPE=['NO WAY','W','INSANE','CLIP IT','LETS GOOO','POGGERS','W W W','HOLY','🔥🔥🔥','KEKW','OMG','WHAT A PLAY','sheeeesh','insane clutch','CLIP THAT','massive W','😱😱😱'];
