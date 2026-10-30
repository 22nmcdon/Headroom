# plugins

Seven devices. Each folder holds one, and the folder is named for the product
rather than for the nickname the code uses - see `saturation/README.md` for
why `HEAT_` stayed.

A device is usually four files:

    plugin.js   the face: markup, canvases, knobs, what it draws
    <maths>.js  the arithmetic, over plain arrays, with no Web Audio in it
    node.js     the AudioWorklet wrapper, where there is one
    player.js   auditioning it against a loop

`level/` has no `node.js` and never will: its processing is one multiply, so a
GainNode and the arithmetic are the same thing without anybody arranging it.
It is the only face here where the meters are the instrument rather than a
readout beside one.

## What goes on a face, and what does not

Three rules, in the order they win when they disagree. These used to live in
`styles.css`, which was a strange home for a rule about dependency arrows.

**One: the plugin is a real plugin.** Nothing on it is built worse because
teaching is its first job. Somebody practising on a thin tool learns a thin
skill, and it would not transfer to the plugins they go on to use, which is
the only reason any of this is worth doing.

**Two: the plugin shows what is, the exercise shows what should be.** Meters,
curves, readouts, a reading that dims because it is stale - that is the device
being honest about itself, and it ships. A target, a tolerance, a verdict, a
hint: those need somebody to already know the answer, and they belong to the
exercise. The test for anything new is whether drawing it requires knowing the
right answer.

Note what that does not say. A display is not teaching furniture merely
because teaching is why it was built: the harmonic series on the saturator is
there to teach, and it is also the best meter on the face and the one no
shipping saturator gives you. The rule is about answers, not subjects.

**Three: the exercise draws outside the chassis.** Not "additive and
removable" - a target dashed across a meter is still a mark on a device that
will not have one, and somebody who learns to hit it has learned to read a
mark rather than to hear. What the exercise has to say goes on the paper below
the plugin. The one thing it may do to the face is switch something off, and a
thing switched off is dimmed where it stands, never removed: a plugin missing
a control is a different plugin.

Rule two is also the dependency arrow, from the other side, and
`tests/seams.test.js` holds it: nothing here may import from `learn/`.
