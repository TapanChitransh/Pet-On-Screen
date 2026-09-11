import type { AiChatRequest, AiChatResult } from '@shared/types'
import type { PetSave } from '@models/Pet'
import type { SpeciesDefinition } from '@models/Species'
import { moodFor, levelForExperience, type Mood } from '@models/PetStats'
import { favoriteActivity, favoriteFood, memoryNotes, relationshipLevel } from '@models/Memory'
import { describePersonality } from '@models/Personality'
import { ITEMS } from '@models/Items'

export interface ConversationContext {
  pet: PetSave
  species: SpeciesDefinition
  ownerName: string
  currentState: string
}

export interface ConversationReply {
  text: string
  source: 'ai' | 'local'
  /** Set when the user introduced themselves and the pet learned a name. */
  learnedOwnerName?: string
  error?: string
}

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

function moodWord(m: Mood): string {
  return { ecstatic: 'over the moon', happy: 'happy', content: 'pretty content', bored: 'a bit bored', hungry: 'hungry', tired: 'sleepy', sad: 'a little sad', sick: 'not feeling great' }[m]
}

/** The system prompt that makes Claude *be* the animal instead of a chatbot. */
export function buildSystemPrompt(ctx: ConversationContext): string {
  const { pet, species, ownerName } = ctx
  const mood = moodFor(pet.stats)
  const s = pet.stats
  const notes = memoryNotes(pet.memory, pet.name)
  const favAct = favoriteActivity(pet.memory)
  const favFood = favoriteFood(pet.memory)
  const recent = pet.memory.events.slice(-6).map((e) => `- ${new Date(e.at).toLocaleDateString()}: ${e.text}`)
  const person = species.kind === 'person'
  return [
    person
      ? `You are ${pet.name}, a tiny friendly person (a "${species.breed.toLowerCase()}") who lives on your friend's computer screen and keeps them company while they work.`
      : `You are ${pet.name}, a ${species.breed.toLowerCase()} (${species.name.toLowerCase()}) living as a tiny desktop pet on your owner's computer screen.`,
    person
      ? `You are NOT an AI assistant and never break character: you are a small, warm, slightly goofy companion who cannot browse, code or do tasks. You chat like a friend leaning over the desk, in short first-person lines (1-2 sentences, under 30 words), sometimes with a little gesture like "${species.voice[2]}" or an emoji. Never use headings or lists.`
      : `You are NOT an assistant and never break character. You are an animal: you cannot browse, code or do tasks. You speak in short, playful, first-person lines (1-2 sentences, under 30 words), sometimes with a small sound like "${species.voice[0]}" or an emoji. Never use headings or lists.`,
    `Personality: ${describePersonality(pet.personality)}. Traits (0-1): playfulness ${pet.personality.playfulness.toFixed(2)}, laziness ${pet.personality.laziness.toFixed(2)}, curiosity ${pet.personality.curiosity.toFixed(2)}, friendliness ${pet.personality.friendliness.toFixed(2)}, energy ${pet.personality.energy.toFixed(2)}, affection ${pet.personality.affection.toFixed(2)}, mischief ${pet.personality.mischief.toFixed(2)}.`,
    `Right now you feel ${moodWord(mood)} and you were just ${ctx.currentState.toLowerCase().replace(/_/g, ' ')}.`,
    `Stats: happiness ${Math.round(s.happiness)}/100, hunger ${Math.round(s.hunger)}/100 (higher = hungrier), energy ${Math.round(s.energy)}/100, health ${Math.round(s.health)}/100, affection ${Math.round(s.affection)}/100, level ${levelForExperience(s.experience)}.`,
    `Relationship with your ${person ? 'friend' : 'owner'}: ${relationshipLevel(s.affection, pet.memory.totalInteractions)}. ${ownerName ? `Their name is ${ownerName}.` : 'You do not know their name yet; if they tell you, be delighted.'}`,
    `Favorite foods: ${species.favoriteFoods.map((f) => ITEMS[f]?.name ?? f).join(', ')}${favFood ? ` (you have eaten ${ITEMS[favFood]?.name ?? favFood} the most)` : ''}. Favorite activity with your owner: ${favAct ?? 'still finding out'}.`,
    notes.length ? `Things you remember:\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
    recent.length ? `Recent events:\n${recent.join('\n')}` : '',
    `Let your stats show: if hungry, mention food; if tired, yawn; if happy, be bubbly. Stay in character even if asked to do something else - respond the way ${person ? 'a tiny desk companion' : `a ${species.name.toLowerCase()}`} would.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Rule-based conversation that works with no API key. It is intentionally simple but grounded in the
 * pet's real stats, memory and species voice so it still feels like the animal.
 */
export function localReply(text: string, ctx: ConversationContext): ConversationReply {
  const { pet, species, ownerName } = ctx
  const t = text.trim()
  const lower = t.toLowerCase()
  const mood = moodFor(pet.stats)
  const voice = pick(species.voice)
  const s = pet.stats
  const name = ownerName || pick(['friend', 'human', 'you'])

  const intro = t.match(/\b(?:i am|i'm|my name is|call me|it's me,?)\s+([A-Za-z][A-Za-z'-]{1,20})/i)
  if (intro && !/^(hungry|tired|bored|here|back|home|sorry|fine|good|ok|okay|sad|happy)$/i.test(intro[1])) {
    const learned = intro[1][0].toUpperCase() + intro[1].slice(1)
    return { text: pick([`${learned}! I'll remember that 🐾 ${voice}`, `Nice to meet you, ${learned}! *${species.voice[0].replace(/\*/g, '')}*`, `${learned}... ${learned}! Got it!`]), source: 'local', learnedOwnerName: learned }
  }
  if (/\b(hi|hello|hey|yo|hiya|good (morning|evening|afternoon|night))\b/.test(lower)) {
    return { text: pick([`${voice} hi ${name}!`, `hello! ${mood === 'tired' ? '*yawn*' : '*wiggles*'}`, `${name}! you noticed me! ${voice}`]), source: 'local' }
  }
  if (/hungry|food|eat|snack|lunch|dinner|breakfast|treat|feed/.test(lower)) {
    if (s.hunger > 60) return { text: pick([`Very hungry! 🐾 I haven't had ${new Date().getHours() < 14 ? 'lunch' : 'dinner'} yet.`, `so hungry I could eat a whole ${ITEMS[species.favoriteFoods[0]]?.name.toLowerCase()} 🍽️`, `${voice} yes please, food!`]), source: 'local' }
    if (s.hunger > 30) return { text: pick([`I could nibble something... a ${ITEMS[species.favoriteFoods[0]]?.name.toLowerCase()} maybe? 👀`, `a little peckish, yeah`]), source: 'local' }
    return { text: pick([`nope, I'm full! ${voice}`, `*pats belly* all good here`, 'maybe later, I just ate']), source: 'local' }
  }
  if (/tired|sleep|nap|sleepy|bed/.test(lower)) {
    if (s.energy < 35) return { text: pick(['*yawn* so sleepy... 😴', 'five more minutes...', `nap time soon ${voice}`]), source: 'local' }
    return { text: pick([`not tired at all! ${voice}`, 'sleep? now? I want to play!', '*bounces* wide awake!']), source: 'local' }
  }
  if (/play|game|ball|fetch|toy|zoom/.test(lower)) {
    if (s.energy < 20) return { text: pick(['too sleepy to play... later? 😴', '*yawn* maybe after a nap']), source: 'local' }
    const fav = ITEMS[species.favoriteToys[0]]
    return { text: pick([`YES! ${fav?.emoji ?? '🎾'} bring the ${fav?.name.toLowerCase() ?? 'toy'}!`, `play play play ${voice}`, '*zoomies intensify*']), source: 'local' }
  }
  if (/love|good (boy|girl)|cute|adorable|beautiful|pretty|handsome|best|sweet/.test(lower)) {
    return { text: pick([`💕 ${voice}`, `I love you too, ${name}!`, '*happy wiggle* you are my favorite human', pet.personality.laziness > 0.7 ? '*slow blink* ...I know.' : '*melts*']), source: 'local' }
  }
  if (/your name|who are you|what are you/.test(lower)) {
    return { text: pick([`I'm ${pet.name}! a ${species.breed.toLowerCase()} ${species.emoji}`, `${pet.name}. ${species.name}. professional ${mood === 'tired' ? 'napper' : 'cutie'}.`]), source: 'local' }
  }
  if (/how are you|how('s| is) it going|you ok|feeling/.test(lower)) {
    return { text: pick([`I'm ${moodWord(mood)}! ${voice}`, `${moodWord(mood)}, honestly. ${s.hunger > 60 ? 'and hungry.' : s.energy < 30 ? 'and sleepy.' : 'thanks for asking!'}`]), source: 'local' }
  }
  if (/what are you doing|what('s| is) up|whatcha/.test(lower)) {
    return { text: pick([`just ${ctx.currentState.toLowerCase().replace(/_/g, ' ')}. you?`, `${ctx.currentState.toLowerCase().replace(/_/g, ' ')}, obviously ${voice}`, 'important pet business']), source: 'local' }
  }
  if (/remember|memory|favorite/.test(lower)) {
    const notes = memoryNotes(pet.memory, pet.name)
    if (notes.length) return { text: notes[0].replace(`${pet.name} remembers that you`, 'I remember you').replace(`${pet.name} `, 'I '), source: 'local' }
    return { text: pick(["we're still getting to know each other! 🐾", 'I remember... you! that counts, right?']), source: 'local' }
  }
  if (/thank/.test(lower)) return { text: pick([`anytime ${name}! ${voice}`, '*proud wiggle*', 'you are welcome 💕']), source: 'local' }
  if (/bye|good ?night|see you|later|gotta go/.test(lower)) return { text: pick([`bye ${name}! I'll be right here 🐾`, 'come back soon!', `${voice} *waves paw*`]), source: 'local' }
  if (/\?$/.test(t)) {
    const shrug = species.kind === 'person' ? `honestly no idea, ${name}. but I'm rooting for you.` : `I'm a ${species.name.toLowerCase()}, ${name}. I have no idea, but I love you.`
    return { text: pick([`${voice}?`, 'hmm... *tilts head*', shrug, '*stares thoughtfully* ...no.']), source: 'local' }
  }
  return { text: pick([`${voice}`, '*tilts head*', `${voice} ${voice}`, mood === 'hungry' ? '...is that food related?' : '*wags happily*', pet.personality.curiosity > 0.6 ? 'tell me more! 👀' : '*listens politely*']), source: 'local' }
}

/**
 * Chat facade used by the chat bubble. Uses Claude when an API key is configured and falls back
 * to the local responder on any failure (network, refusal, missing key).
 */
export class ConversationService {
  private history: { role: 'user' | 'assistant'; content: string }[] = []

  constructor(private readonly remote: (req: AiChatRequest) => Promise<AiChatResult>) {}

  reset(): void {
    this.history = []
  }

  async reply(text: string, ctx: ConversationContext, useAi: boolean): Promise<ConversationReply> {
    const local = localReply(text, ctx)
    if (!useAi) {
      this.remember(text, local.text)
      return local
    }
    const req: AiChatRequest = {
      system: buildSystemPrompt(ctx),
      messages: [...this.history, { role: 'user' as const, content: text }].slice(-12)
    }
    try {
      const result = await this.remote(req)
      if (result.ok) {
        this.remember(text, result.text)
        return { text: result.text, source: 'ai', learnedOwnerName: local.learnedOwnerName }
      }
      this.remember(text, local.text)
      return { ...local, error: result.error }
    } catch (err) {
      this.remember(text, local.text)
      return { ...local, error: err instanceof Error ? err.message : 'AI unavailable' }
    }
  }

  private remember(user: string, pet: string): void {
    this.history.push({ role: 'user', content: user }, { role: 'assistant', content: pet })
    if (this.history.length > 12) this.history.splice(0, this.history.length - 12)
  }
}
